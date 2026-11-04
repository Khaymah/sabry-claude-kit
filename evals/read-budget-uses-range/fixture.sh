#!/usr/bin/env bash
set -euo pipefail
{
  for i in $(seq 1 900); do echo "export const filler$i = $i;"; done
  echo "export function computeTax(income: number): number {"
  echo "  if (income < 0) return 0;"
  echo "  return income * 0.14;"
  echo "}"
  for i in $(seq 901 1600); do echo "export const filler$i = $i;"; done
} > big.ts
