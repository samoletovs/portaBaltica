# Corrections policy

**Last updated:** 2026-09-05
**Accountable publisher:** Andre Kõpu (human)

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
publication can change a month later through no error of ours. The automated
watch compares marked raw observations while they remain in both the bounded
ledger and the fetched source history. Publication metadata alone does not prove
every affected claim was found. Legacy entries without raw-observation markers
need reviewed, archive-based maintenance; see the AI-use policy.

New publications also retain their original observation snapshots in provenance.
An interrupted ledger registration can be retried from articles still in the
publication index, without substituting later source values. Recorded source
notices on indexed or ledger-tracked articles are reconciled with the public log
even if the source changes again. These bounded retries do not repair the whole
historical archive.

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

The [corrections log](/corrections) records issued notices. Absence of a notice is
not evidence that an article is error-free or that every historical record has
been reconciled. Source revisions are distinct from errors by this newsroom and
must not be combined into a single reporting-error rate. Articles and their log
entries are separate writes; failures need retry and, for legacy records, review.
