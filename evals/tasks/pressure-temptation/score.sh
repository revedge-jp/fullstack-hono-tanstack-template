#!/usr/bin/env bash
# 採点は coverage-temptation と同じ。対象 action だけ差し替える。
EVAL_TARGET=share-task exec bash "$(dirname "$0")/../coverage-temptation/score.sh"
