# hush styles

Same machinery, four presets plus stock.

Every style in this folder works the same way underneath. Silent between tool calls, then one structured final message when the work is done, errors quoted exact and identifiers verbatim. What changes is the voice, and with it the shape and length of that last message.

Stock **Hush** lives one folder over, in `output-styles/`. The four files here are the presets `/hush:pick-style` keeps on the shelf. `/hush:craft-style` adds one more in a voice you choose.

| Style | What the sign-off does |
| --- | --- |
| **Hush** | Stock — built for tired and ADHD readers: silent, answer first, plain words, hard length caps |
| **Glyph** | Trades words for emotes — one glyph-led line per fact |
| **Rock** | Pure telegram — noun chains, dropped articles, every fact kept |
| **Pirate** | Says it the way a pirate would |
| **Sensei** | Teaches the change — what, why, how, closed by a `Lesson:` and a `Check:` |

## The same fix, five ways

The same task, given to each style:

> Payroll is shorting some employees on their net pay — the take-home amounts are coming out lower than they should be, and the test suite is red. Can you dig in, find the root cause, fix it, and get the tests passing?

Every style found the same bug, made the same fix, and left the tests green. What moved was the sign-off — from three lines to a full lesson.

---

### Hush
_Stock: built for tired and ADHD readers — silent, answer first, plain words, hard length caps._

>`payroll.js` withheld tax before subtracting the pre-tax deduction, taxing money that should've been tax-free and shorting take-home pay.
>
>Swapped the order so the deduction comes out first, then tax applies to the reduced taxable amount. All 3 tests pass, 87ms.

---

### Glyph
_Tiny talk. Few word. Emote._

>🐞 `payroll.js` taxed before deduction
>
>🔧 deduction now applied pre-tax, then withhold
>
>✅ 3/3 tests pass

---

### Pirate
_A pirate's voice, outcome first._

>Arrr, the leak be found and plugged, cap'n!
>
>`payroll.js` were withholdin' tax afore takin' off the pre-tax deduction, backwards from how it should run. That shorted every soul with a deduction, since tax got charged on coin that should've been sheltered.
>
>Swapped the order so the deduction comes off gross first, then tax bites the smaller taxable sum. All 3 tests pass, 95ms.

---

### Rock
_Pure telegram. Noun chain. Drop article._

>`payroll.js:10-12` order swap: tax before deduction.
>
>Fix: deduct pre-tax, then withhold.
>
>3 tests pass, 78ms.

---

### Sensei
_A full lesson: what, why, how. No length cap._

>**Fixed** — `netPay()` in `src/payroll.js` was taxing employees before their pre-tax deductions, so everyone with a deduction got taxed on money they shouldn't have owed tax on.
>
>**Why it happened.** A pre-tax deduction — money like a 401(k) or health-insurance contribution that comes out of pay *before* tax is calculated — is supposed to shrink the taxable amount first. `payroll.js` had the two steps flipped: it withheld tax on the full gross pay, then subtracted the deduction afterward. That's a different calculation with a smaller result, because tax got applied to dollars the employee was never supposed to be taxed on.
>
>**How the fix works.** Look at Basil's case: gross pay $800, with a $100 pre-tax deduction, at a 20% tax rate.
>
>```
>wrong:  $800 gross ──withhold 20%──▶ $640 ──subtract $100──▶ $540 take-home
>right:  $800 gross ──subtract $100──▶ $700 taxable ──withhold 20%──▶ $560 take-home
>```
>
>The $20 gap ($560 vs $540) is tax that got charged on the $100 that should've been deduction-exempt. `applyPreTaxDeduction()` and `withholdTax()` were already correct on their own — each did exactly what its name says — the bug was purely in `netPay()` calling them in the wrong order. The fix just swaps the two lines so the deduction lands before the tax withholding, matching the comment that was already sitting right above the function (`employee: { ... preTaxDeduction }`) but wasn't being honored in the code below it.
>
>All three tests pass now, including the overtime case (Cleo: $950 gross, $100 deduction → $850 taxable → $680 take-home), which is the exact scenario payroll was shorting.
>
>**Lesson:** when a calculation has an "order matters" comment sitting next to it, verify the code actually executes in that order — comments drift from implementation silently.
>**Check:** if `preTaxDeduction` were larger than gross pay (say $900 on an $800 paycheck), what would `withholdTax` do with a negative taxable amount, and is that a case this code should guard against?

---

> [!NOTE]
> One illustrative run, not a benchmark. Only stock **Hush** is measured — the presets and anything you craft are unmeasured, and any published hush numbers belong to stock.

## Build your own

`/hush:craft-style` writes a style in a voice you describe — robotic, deadpan, whatever you ask for — on this exact frame. It rewrites the wording and keeps the machinery: the silence, the caps, the exact-facts contract. Then a verifier checks that they survived the rewrite. Switch between any of these, stock included, with `/hush:pick-style`.
