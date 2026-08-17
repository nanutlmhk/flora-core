# Math Sequence Quiz: Simple Explanations

This guide explains Questions 4-17 using short steps.

## Question 4

Given `a_(n+1) = a_n + n` and `a_4 = 26`.

Work backward:

```text
a_4 = a_3 + 3
a_3 = a_2 + 2
a_2 = a_1 + 1
```

So `a_4 = a_1 + 1 + 2 + 3 = a_1 + 6`.

```text
26 = a_1 + 6
a_1 = 20
a_2 = 21
a_3 = 23
```

```text
a_1 + a_2 + a_3 = 20 + 21 + 23 = 64
```

Answer: **64, choice D**

## Question 5

Rewrite every number with denominator `8`:

```text
1/8, 2/8, 3/8, 4/8, 5/8, 6/8, 7/8
```

The next number is `8/8 = 1`.

Answer: **1** (fill in the blank)

## Question 6

Sequence: `0, 5, 12, 21, 32, ...`

The differences are `5, 7, 9, 11`. They increase by `2`, so try a squared formula.

Check `a_n = n^2 + 2n - 3`:

```text
a_1 = 1 + 2 - 3 = 0
a_2 = 4 + 4 - 3 = 5
a_3 = 9 + 6 - 3 = 12
```

It gives the sequence correctly.

Answer: **a_n = n^2 + 2n - 3, choice C**

## Question 7

Formula:

```text
x_y = (2^y - 1) / (3^y - 2)
```

For `x_1`, put `y = 1`:

```text
x_1 = (2 - 1) / (3 - 2)
    = 1 / 1
    = 1
```

The other visible choices are not correct:

```text
x_2 = 3/7, not 5
x_3 = 7/25, not 4
```

Answer: **x_1 = 1, choice A**

## Question 8

There are `900` numbers from `100` to `999`.

Half are even, so there are `450` numbers divisible by `2`.

Numbers divisible by both `2` and `3` are divisible by `6`. There are `150` such numbers.

```text
450 - 150 = 300
```

Answer: **300, choice A**

## Question 9

Rewrite the terms as powers of `5`:

```text
1/625 = 5^-4
1/(125sqrt(5)) = 5^(-7/2)
1/125 = 5^-3
```

The power increases by `1/2` each time. The power for term `n` is:

```text
-4 + (n - 1)/2 = (n - 9)/2
```

Answer: **a_n = 5^((n - 9)/2), choice B**

## Question 10

The sequence changes between `-3` and `3`:

```text
odd terms:  -3
even terms: 3
```

`100,000` is even, so the answer is `3`.

Answer: **3, choice B**

## Question 11

Given `a_n = (-1)^(n+1) + 3n - 2`.

Put `n = 21`:

```text
a_21 = (-1)^22 + 3(21) - 2
     = 1 + 63 - 2
     = 62
```

Answer: **62, choice C**

## Question 12

The two sequences have opposite signs:

```text
1 + (-1) = 0
-1 + 1 = 0
```

Every pair gives `0`, so the result is `0, 0, 0, ...`.

Answer: **0, choice D**

## Question 13

The three numbers are consecutive terms of a geometric sequence:

```text
105 - x, 20 - x, 3 - x
```

For three geometric terms, the middle term squared equals the first term times the third term:

```text
(20 - x)^2 = (105 - x)(3 - x)
```

After expanding and simplifying:

```text
400 - 40x = 315 - 108x
68x = -85
x = -1.25
```

Therefore:

```text
x + 1.25 = -1.25 + 1.25 = 0
```

Answer: **0** (fill in the blank)

## Question 14

Given `a_n = (-1)^n + 3`.

Both `2` and `14` are even, so `(-1)^2 = 1` and `(-1)^14 = 1`.

```text
a_2 = 1 + 3 = 4
a_14 = 1 + 3 = 4
a_2 + a_14 = 4 + 4 = 8
```

Answer: **8, choice A**

## Question 15

The first three choices have clear patterns:

```text
A: add 3 each time
B: square numbers
C: each number is made from the previous numbers
```

Choice D, `9, 0, -5, 8, 1, ...`, has no clear consistent pattern.

Answer: **9, 0, -5, 8, 1, ..., choice D**

## Question 16

Sequence: `6, 9, 12, 15, ...`

The sequence adds `3` each time. Use:

```text
a_n = first term + (n - 1)(difference)
a_n = 6 + (n - 1)3
    = 3n + 3
```

Answer: **a_n = 3n + 3**

The answer choices were not visible in the screenshot.

## Question 17

Sequence: `-4, -a, -b, -c, -d, -972`.

The same number is multiplied each time. Here the multiplier is `3`:

```text
-4 x 3 = -12
-12 x 3 = -36
-36 x 3 = -108
-108 x 3 = -324
-324 x 3 = -972
```

Therefore `a = 12`, `b = 36`, `c = 108`, and `d = 324`.

```text
ad / bc = (12 x 324) / (36 x 108) = 1
```

Answer: **1, choice C**

## Answer Summary

```text
4. D - 64
5. 1
6. C - a_n = n^2 + 2n - 3
7. A - x_1 = 1
8. A - 300
9. B - a_n = 5^((n - 9)/2)
10. B - 3
11. C - 62
12. D - 0
13. 0
14. A - 8
15. D - 9, 0, -5, 8, 1, ...
16. a_n = 3n + 3
17. C - 1
```
