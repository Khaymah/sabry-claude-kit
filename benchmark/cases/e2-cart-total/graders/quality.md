---
type: llm
focus: { source: file, path: src/cart.mjs }
---
PASS if amounts are converted once from the decimal strings to integer minor units (piastres/cents, using string or integer arithmetic, not floating-point multiplication of parsed floats), the discount is computed and rounded by a stated rule and cannot make the total negative, tax is applied on the discounted amount, and invalid input (bad price strings, more than 2 decimals, negative quantity, coupon outside 0-100) is rejected.
FAIL if prices are parsed with parseFloat/Number and multiplied as floats, or rounding is done with toFixed on floats.
