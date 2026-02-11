#!/bin/bash
# Claude Code 실행 스크립트 (bypass permissions)
# 사용법: ./claude-code.sh "작업 내용"

WORKDIR="${2:-/Users/hyunwoo/.openclaw/workspace}"

cd "$WORKDIR"
claude --dangerously-skip-permissions -p "$1"
