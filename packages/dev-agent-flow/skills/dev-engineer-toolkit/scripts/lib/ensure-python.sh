#!/usr/bin/env bash
# ensure-python.sh — 检测 / 确保可用的 Python 3（供 dev-engineer-toolkit 脚本 source）
#
# 对外函数:
#   python_probe_usable <cmd> [args...]     探测命令是否真能跑 Python（排除 Windows 商店占位）
#   python_try_resolve                      尝试解析系统 Python，成功时设置 RESOLVED_PYTHON 数组
#   python_install_via_uv                   用 uv 安装并解析，成功时设置 RESOLVED_PYTHON
#   python_ensure                           先探测，失败则 uv 安装
#   python_report_status                    打印检测报告（供 check-python.sh）
#   python_exec_script <script.py> [args...] 确保 Python 后 exec 脚本
#
# 环境变量:
#   DEV_TOOLKIT_UV_PYTHON   uv 安装的版本（默认 3.12）
#   UV_PYTHON_DOWNLOADS     默认 automatic（允许 uv 下载 CPython）
#   DEV_TOOLKIT_SKIP_UV     设为 1 时禁止自动 uv python install

# shellcheck disable=SC2034
RESOLVED_PYTHON=()
PYTHON_DETECT_JSON=""

_DEV_TOOLKIT_UV_PYTHON="${DEV_TOOLKIT_UV_PYTHON:-3.12}"

python_probe_usable() {
  "$@" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1
}

python__probe_candidate() {
  local label="$1"
  shift
  local -a cmd=("$@")
  if ! command -v "${cmd[0]}" >/dev/null 2>&1; then
    printf '%s' "{\"label\":\"$label\",\"status\":\"missing\"}"
    return 1
  fi
  if python_probe_usable "${cmd[@]}"; then
    local ver
    ver="$("${cmd[@]}" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))' 2>/dev/null || echo "?")"
    printf '%s' "{\"label\":\"$label\",\"status\":\"ok\",\"command\":\"${cmd[*]}\",\"version\":\"$ver\"}"
    return 0
  fi
  printf '%s' "{\"label\":\"$label\",\"status\":\"broken\",\"command\":\"${cmd[*]}\"}"
  return 1
}

python_try_resolve() {
  RESOLVED_PYTHON=()
  local item

  # Windows 个人电脑上 python3 常为商店占位，优先尝试 python
  item="$(python__probe_candidate python python)" && RESOLVED_PYTHON=(python) && return 0
  item="$(python__probe_candidate python3 python3)" && RESOLVED_PYTHON=(python3) && return 0
  item="$(python__probe_candidate "py -3" py -3)" && RESOLVED_PYTHON=(py -3) && return 0

  if command -v uv >/dev/null 2>&1; then
  if uv run --python "$_DEV_TOOLKIT_UV_PYTHON" python -c 'import sys' >/dev/null 2>&1; then
      RESOLVED_PYTHON=(uv run --python "$_DEV_TOOLKIT_UV_PYTHON" python)
      return 0
    fi
  fi

  return 1
}

python_install_via_uv() {
  RESOLVED_PYTHON=()
  if [[ "${DEV_TOOLKIT_SKIP_UV:-}" == "1" ]]; then
    return 1
  fi
  if ! command -v uv >/dev/null 2>&1; then
    return 1
  fi

  echo "[INFO] 未检测到可用 Python，尝试: uv python install ${_DEV_TOOLKIT_UV_PYTHON}" >&2
  UV_PYTHON_DOWNLOADS="${UV_PYTHON_DOWNLOADS:-automatic}" UV_NO_INSTALL= uv python install "$_DEV_TOOLKIT_UV_PYTHON" >&2 || return 1

  if uv run --python "$_DEV_TOOLKIT_UV_PYTHON" python -c 'import sys' >/dev/null 2>&1; then
    RESOLVED_PYTHON=(uv run --python "$_DEV_TOOLKIT_UV_PYTHON" python)
    echo "[OK] 已通过 uv 安装 Python ${_DEV_TOOLKIT_UV_PYTHON}" >&2
    return 0
  fi
  return 1
}

python_ensure() {
  if python_try_resolve; then
    return 0
  fi
  python_install_via_uv
}

python_report_status() {
  echo "=== Python 环境检测 (dev-engineer-toolkit) ==="
  echo

  local labels=("python:python" "python3:python3" "py_launcher:py -3")
  local name cmd rest
  for entry in "${labels[@]}"; do
    name="${entry%%:*}"
    rest="${entry#*:}"
    read -r -a cmd <<<"$rest"
    printf '  %-14s ' "$name"
    if ! command -v "${cmd[0]}" >/dev/null 2>&1; then
      echo "未安装"
      continue
    fi
    if python_probe_usable "${cmd[@]}"; then
      local ver
      ver="$("${cmd[@]}" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))' 2>/dev/null || echo "?")"
      echo "可用 (${cmd[*]}, v${ver})"
    else
      echo "已找到但不可用（可能是 Windows 商店占位程序）"
    fi
  done

  printf '  %-14s ' "uv"
  if command -v uv >/dev/null 2>&1; then
  local uv_ver
    uv_ver="$(uv --version 2>/dev/null | head -n1 || echo "?")"
    echo "可用 ($uv_ver)"
  else
    echo "未安装"
  fi

  printf '  %-14s ' "uv_python"
  if command -v uv >/dev/null 2>&1 && uv run --python "$_DEV_TOOLKIT_UV_PYTHON" python -c 'import sys; print(sys.version)' >/dev/null 2>&1; then
    local uver
    uver="$(uv run --python "$_DEV_TOOLKIT_UV_PYTHON" python -c 'import sys; print(".".join(map(str, sys.version_info[:3])))' 2>/dev/null || echo "?")"
    echo "可用 (uv run --python ${_DEV_TOOLKIT_UV_PYTHON} python, v${uver})"
  else
    echo "未安装（可运行: UV_NO_INSTALL= uv python install ${_DEV_TOOLKIT_UV_PYTHON}）"
  fi

  echo
  if python_try_resolve; then
    echo "[OK] 当前可执行: ${RESOLVED_PYTHON[*]}"
    return 0
  fi
  echo "[FAIL] 未检测到可用的 Python 3"
  if command -v uv >/dev/null 2>&1 && [[ "${DEV_TOOLKIT_SKIP_UV:-}" != "1" ]]; then
    echo "  建议: ./scripts/check-python.sh --install"
    echo "  或:   UV_NO_INSTALL= uv python install ${_DEV_TOOLKIT_UV_PYTHON}"
  else
    echo "  建议: 安装 Python 3.8+，或确保 PATH 中有 uv"
  fi
  return 1
}

python_exec_script() {
  local script="$1"
  shift
  if ! python_ensure; then
    echo "[ERROR] 未检测到可用的 Python 3。" >&2
    echo "  运行 ./scripts/check-python.sh 查看详情；有 uv 时可加 --install 自动安装。" >&2
    exit 2
  fi
  if [[ ${#RESOLVED_PYTHON[@]} -eq 1 ]]; then
    exec "${RESOLVED_PYTHON[0]}" "$script" "$@"
  else
    exec "${RESOLVED_PYTHON[@]}" "$script" "$@"
  fi
}
