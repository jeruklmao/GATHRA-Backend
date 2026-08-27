#!/usr/bin/env python3
"""Fixed, read-only host observer for the GATHRA admin dashboard.

This process has no listener and accepts no commands. It publishes bounded,
sanitized snapshots through atomic files for a read-only container mount.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

OUTPUT = Path("/run/gathra-admin-observer")
COMPOSE_SERVICES = ("backend", "postgres", "routing-engine", "photon")
JOURNAL_UNITS = {"gathra-service": "gathra.service", "cloudflared": "cloudflared.service"}
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
SECRET = re.compile(r"(?i)\b(authorization|cookie|set-cookie|password|token|secret)\b\s*[:=]\s*\S+")


def run(command: list[str], timeout: float = 2.5) -> str:
    result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, timeout=timeout,
                            check=False, env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"})
    if result.returncode != 0:
        raise RuntimeError(f"{command[0]} returned {result.returncode}")
    return result.stdout


def run_logs(command: list[str], timeout: float = 5.0) -> str:
    result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, timeout=timeout,
                            check=False, env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"})
    return result.stdout


def safe_line(value: str) -> str:
    value = ANSI.sub("", value)
    value = CONTROL.sub("", value)
    value = SECRET.sub(lambda match: f"{match.group(1)}=[REDACTED]", value)
    return value[:4096]


def atomic_write(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(contents, encoding="utf-8")
    os.chmod(temporary, 0o640)
    os.replace(temporary, path)


def memory() -> dict[str, int]:
    values: dict[str, int] = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        name, raw = line.split(":", 1)
        values[name] = int(raw.strip().split()[0]) * 1024
    total = values.get("MemTotal", 0)
    available = values.get("MemAvailable", 0)
    swap_total = values.get("SwapTotal", 0)
    swap_free = values.get("SwapFree", 0)
    return {"totalBytes": total, "availableBytes": available,
            "usedBytes": max(0, total - available), "swapTotalBytes": swap_total,
            "swapUsedBytes": max(0, swap_total - swap_free)}


def cpu_ticks() -> tuple[int, int]:
    fields = [int(item) for item in Path("/proc/stat").read_text().splitlines()[0].split()[1:]]
    idle = fields[3] + (fields[4] if len(fields) > 4 else 0)
    return sum(fields), idle


def container_id(service: str) -> str | None:
    output = run(["docker", "ps", "--filter", f"label=com.docker.compose.service={service}",
                  "--format", "{{.ID}}"], 3).strip().splitlines()
    identifier = output[0] if output else ""
    return identifier if re.fullmatch(r"[a-f0-9]{12,64}", identifier) else None


def containers() -> tuple[dict[str, Any], dict[str, str]]:
    status: dict[str, Any] = {}
    identifiers: dict[str, str] = {}
    for service in COMPOSE_SERVICES:
        identifier = container_id(service)
        if identifier is None:
            status[service] = {"state": "unavailable"}
            continue
        identifiers[service] = identifier
        inspection = json.loads(run(["docker", "inspect", identifier], 4))[0]
        state = inspection.get("State", {})
        config = inspection.get("Config", {})
        stats_raw = run(["docker", "stats", "--no-stream", "--format", "{{json .}}", identifier], 4).strip()
        stats = json.loads(stats_raw) if stats_raw else {}
        status[service] = {
            "state": state.get("Status", "unknown"),
            "health": state.get("Health", {}).get("Status"),
            "restartCount": int(inspection.get("RestartCount", 0)),
            "pid": int(state.get("Pid", 0)),
            "image": str(config.get("Image", ""))[:200],
            "cpuPercent": parse_percent(stats.get("CPUPerc")),
            "memoryUsedBytes": parse_size(str(stats.get("MemUsage", "")).split("/")[0].strip()),
            "memoryPercent": parse_percent(stats.get("MemPerc")),
            "pids": parse_int(stats.get("PIDs")),
        }
    return status, identifiers


def parse_percent(value: Any) -> float | None:
    try:
        return float(str(value).strip().rstrip("%"))
    except ValueError:
        return None


def parse_int(value: Any) -> int | None:
    try:
        return int(str(value))
    except ValueError:
        return None


def parse_size(value: str) -> int | None:
    match = re.fullmatch(r"([0-9.]+)([KMGT]?i?B)", value)
    if not match:
        return None
    units = {"B": 1, "KB": 1000, "MB": 1000**2, "GB": 1000**3, "TB": 1000**4,
             "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "TiB": 1024**4}
    return int(float(match.group(1)) * units[match.group(2)])


def service(unit: str) -> dict[str, str]:
    output = run(["systemctl", "show", unit, "--property=ActiveState,SubState,Result",
                  "--no-pager"], 3)
    return {key[0].lower() + key[1:]: value for key, value in
            (line.split("=", 1) for line in output.splitlines() if "=" in line)}


def release() -> dict[str, Any]:
    target = Path("/opt/gathra/current")
    resolved = str(target.resolve()) if target.exists() else None
    sha = Path(resolved).name if resolved else None
    return {"path": resolved, "gitSha": sha}


def backup() -> dict[str, Any] | None:
    directory = Path("/srv/gathra/backups/postgres")
    candidates = [item for item in directory.glob("*.dump") if item.is_file()] if directory.exists() else []
    if not candidates:
        return None
    latest = max(candidates, key=lambda item: item.stat().st_mtime)
    stat = latest.stat()
    return {"filename": latest.name[:255], "sizeBytes": stat.st_size,
            "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()}


def write_logs(identifiers: dict[str, str]) -> None:
    for service_name in COMPOSE_SERVICES:
        lines = ""
        identifier = identifiers.get(service_name)
        if identifier:
            try:
                lines = run_logs(["docker", "logs", "--tail", "500", "--timestamps", identifier], 5)
            except Exception as error:  # bounded diagnostic only
                lines = f"observer: {type(error).__name__} collecting {service_name} logs"
        sanitized = "\n".join(safe_line(line) for line in lines.splitlines()[-500:]) + "\n"
        atomic_write(OUTPUT / "logs" / f"{service_name}.log", sanitized)
    for source, unit in JOURNAL_UNITS.items():
        try:
            lines = run(["journalctl", "--unit", unit, "--lines", "500", "--no-pager",
                         "--output", "short-iso"], 5)
        except Exception as error:
            lines = f"observer: {type(error).__name__} collecting {source} logs"
        atomic_write(OUTPUT / "logs" / f"{source}.log",
                     "\n".join(safe_line(line) for line in lines.splitlines()[-500:]) + "\n")


def collect(previous_cpu: tuple[int, int] | None) -> tuple[dict[str, Any], tuple[int, int]]:
    errors: list[str] = []
    current_cpu = cpu_ticks()
    cpu_percent = None
    if previous_cpu:
        total = current_cpu[0] - previous_cpu[0]
        idle = current_cpu[1] - previous_cpu[1]
        cpu_percent = round(100 * (total - idle) / total, 2) if total > 0 else None
    mem = memory()
    disk = shutil.disk_usage("/")
    load = os.getloadavg()
    try:
        container_status, identifiers = containers()
    except Exception as error:
        container_status, identifiers = {}, {}
        errors.append(f"containers:{type(error).__name__}")
    services: dict[str, Any] = {}
    for unit in ("gathra.service", "cloudflared.service"):
        try:
            services[unit] = service(unit)
        except Exception as error:
            services[unit] = {"activeState": "unavailable"}
            errors.append(f"{unit}:{type(error).__name__}")
    write_logs(identifiers)
    snapshot = {
        "schemaVersion": 1,
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "host": {"uptimeSeconds": float(Path("/proc/uptime").read_text().split()[0]),
                 "cpuPercent": cpu_percent,
                 "load": {"one": load[0], "five": load[1], "fifteen": load[2]},
                 "memory": {"totalBytes": mem["totalBytes"], "availableBytes": mem["availableBytes"],
                            "usedBytes": mem["usedBytes"]},
                 "swap": {"totalBytes": mem["swapTotalBytes"], "usedBytes": mem["swapUsedBytes"]},
                 "disk": {"totalBytes": disk.total, "usedBytes": disk.used, "availableBytes": disk.free}},
        "containers": container_status,
        "services": services,
        "release": release(),
        "backup": backup(),
        "errors": errors,
    }
    return snapshot, current_cpu


def main() -> None:
    os.umask(0o027)
    OUTPUT.mkdir(parents=True, exist_ok=True, mode=0o750)
    previous: tuple[int, int] | None = None
    while True:
        started = time.monotonic()
        try:
            snapshot, previous = collect(previous)
            atomic_write(OUTPUT / "status.json", json.dumps(snapshot, separators=(",", ":")) + "\n")
        except Exception as error:
            atomic_write(OUTPUT / "status.json", json.dumps({"schemaVersion": 1,
                "observedAt": datetime.now(timezone.utc).isoformat(), "host": {}, "containers": {},
                "services": {}, "release": {}, "backup": None,
                "errors": [f"collector:{type(error).__name__}"]}) + "\n")
        time.sleep(max(0.25, 3.0 - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
