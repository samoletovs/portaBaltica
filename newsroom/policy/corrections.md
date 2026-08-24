# Corrections policy

**Last updated:** 2026-08-24
**Accountable editor:** Sam Samoletovs

## The rule

Corrections are **public, attached to the article, and append-only.**

When we get something wrong we do not quietly replace the text. The article
shows what was wrong, what it now says, and when it changed. The same entry
appears in the public [corrections log](/corrections).

This costs us something — a visible record of every mistake is not flattering.
That is the point. A portal that automates production and hides its error rate
is asking readers to take its accuracy on faith, and the whole argument for
publishing our methods is that faith should not be necessary.

## What counts

| Severity | What it means | What happens |
|---|---|---|
| **Correction** | A factual error: a wrong figure, a misstated comparison, a misattributed source. | Correction notice on the article, entry in the log, article marked `corrected`. |
| **Clarification** | The facts were right but the framing could mislead. | Note appended to the article. |
| **Retraction** | The story should not have been published — the underlying data was invalid, or the premise was wrong. | Article marked `retracted` and removed from feeds. The page stays up, showing why. We do not delete the evidence. |

## Why an automated portal needs this more than most

Our articles are generated from open datasets by software. Two failure modes
follow from that, and neither is hypothetical:

**Upstream data changes.** Statistical agencies revise. A figure correct at
publication can become wrong a month later through no error of ours. Because we
record the dataset and the retrieval timestamp on every article, we can identify
exactly which articles a revision affects — something a human newsroom usually
cannot do at all.

**Systematic errors, not one-off ones.** When a human reporter makes a mistake, one
article is wrong. When a detector or a prompt is wrong, *every article of that
shape* is wrong. So each correction is treated as a bug report against the
pipeline, not just a bad sentence. If a correction reveals a fault the validator
should have caught, the fix is a new validator check with a test — not a note to
be more careful.

That second point is the one worth stating plainly: **a lesson recorded only as
prose is advice, and advice does not execute.**

## Reporting an error

Open an issue at
[github.com/samoletovs/portaBaltica/issues](https://github.com/samoletovs/portaBaltica/issues),
or contact NauroLabs directly.

Please include the article, the figure or claim you believe is wrong, and the
source you are comparing against. Reader-reported errors are the most valuable
signal we get about whether this experiment is working, and we would much rather
hear it from you than not hear it at all.

## Our record

The [corrections log](/corrections) is complete from launch. We publish
corrections per hundred articles as an ongoing metric rather than a claim,
because a portal of this kind should be judged on its error rate and not on its
intentions.
