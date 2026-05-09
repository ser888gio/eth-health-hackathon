import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests


@dataclass
class VqsRequest:
    url: str
    params: dict[str, str]
    headers: dict[str, str]
    body: dict | None


def _normalize_curl(text: str) -> str:
    text = text.replace("\r", "")
    # Handle line continuations for both bash (\) and cmd.exe (^)
    text = re.sub(r"\\\s*\n", " ", text)
    text = re.sub(r"\s*\^\s*\n", " ", text)
    text = text.replace("\n", " ")
    # Unescape caret-escaped characters from Windows cmd.exe cURL copy
    text = text.replace("^^", "^")
    text = re.sub(r"\^([^\s])", r"\1", text)
    return text.strip()


def _extract_url(text: str) -> str:
    match = re.search(r"https?://[^\s'\"\\]+", text)
    if not match:
        raise ValueError("No URL found in cURL text")
    return match.group(0)


def _extract_headers(text: str) -> dict[str, str]:
    headers: dict[str, str] = {}
    patterns = [r"-H\s+'([^']+)'", r"-H\s+\"([^\"]+)\""]
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            header_line = match.group(1).strip()
            if ":" not in header_line:
                continue
            name, value = header_line.split(":", 1)
            key = name.strip()
            if key.lower() == "cookie":
                continue
            headers[key] = value.strip()
    return headers


def _unescape_shell_string(value: str) -> str:
    try:
        return bytes(value, "utf-8").decode("unicode_escape")
    except UnicodeDecodeError:
        return value


def _extract_data(text: str) -> str | None:
    patterns = [
        r"--data-raw\s+\$'([^']*)'",
        r"--data-raw\s+'([^']*)'",
        r'--data-raw\s+\"([^\"]*)\"',
        r"--data\s+\$'([^']*)'",
        r"--data\s+'([^']*)'",
        r'--data\s+\"([^\"]*)\"',
        r"--data-binary\s+\$'([^']*)'",
        r"--data-binary\s+'([^']*)'",
        r'--data-binary\s+\"([^\"]*)\"',
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return _unescape_shell_string(match.group(1))
    return None


def _parse_params(url: str) -> tuple[str, dict[str, str]]:
    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    params = {}
    for key, values in parse_qs(parsed.query, keep_blank_values=True).items():
        if values:
            params[key] = values[0]
    return base_url, params


def parse_vqs_curl(curl_text: str) -> VqsRequest:
    normalized = _normalize_curl(curl_text)
    url = _extract_url(normalized)
    headers = _extract_headers(normalized)
    data_text = _extract_data(normalized)
    body: dict | None
    if data_text:
        try:
            body = json.loads(data_text)
        except json.JSONDecodeError:
            body = {"raw": data_text}
    else:
        body = None

    base_url, params = _parse_params(url)

    return VqsRequest(
        url=base_url,
        params=params,
        headers=headers,
        body=body,
    )


def run_vqs_query(request: VqsRequest, token_override: str | None = None) -> dict[str, Any]:
    headers = dict(request.headers)
    if token_override:
        headers["Authorization"] = f"Bearer {token_override}"
    elif "Authorization" not in headers:
        env_token = os.getenv("SOPHIA_IAM_TOKEN", "").strip()
        if env_token:
            headers["Authorization"] = f"Bearer {env_token}"
    max_retries = int(os.getenv("SOPHIA_VQS_MAX_RETRIES", "3"))
    backoff = float(os.getenv("SOPHIA_VQS_RETRY_BACKOFF", "1.5"))
    retryable = {502, 503, 504}

    for attempt in range(max_retries + 1):
        try:
            response = requests.post(
                request.url,
                params=request.params,
                headers=headers,
                json=request.body,
                timeout=60,
            )
            if response.status_code in retryable and attempt < max_retries:
                time.sleep(backoff * (2 ** attempt))
                continue
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            status = exc.response.status_code if exc.response else None
            if status in retryable and attempt < max_retries:
                time.sleep(backoff * (2 ** attempt))
                continue
            raise

    raise RuntimeError("VQS request failed after retries")


def vqs_response_to_tsv(response: dict[str, Any], max_rows: int | None = None) -> str:
    page = response.get("pageContent") or {}
    columns = page.get("columns") or []
    rows = page.get("data") or []

    if not columns:
        return json.dumps(response, indent=2)

    if max_rows is not None:
        rows = rows[:max_rows]

    lines = ["\t".join(str(c) for c in columns)]
    for row in rows:
        cells = ["" if cell is None else str(cell) for cell in row]
        lines.append("\t".join(cells))
    return "\n".join(lines)
