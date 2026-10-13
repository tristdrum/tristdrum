# TLDR design and examples

Read when maintaining or evaluating the skill. The examples are synthetic, not
conversation records or prescribed wording. Runtime behavior belongs in
[SKILL.md](../SKILL.md).

## Research basis

- [W3C: Provide Summary of Long Documents and Media](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o3p08-summary-provided/)
  recommends brief, understandable summaries that help readers judge relevance,
  using common words and short sentences.
- [Brown and Day: Macrorules for Summarizing Texts](https://files.eric.ed.gov/fulltext/ED225136.pdf)
  examines deleting trivial and redundant material, combining related ideas,
  and selecting or constructing a statement of the main meaning. These operations
  are more useful here than shortening every section proportionally.
- [CDC Clear Communication Index](https://www.cdc.gov/ccindex/pdf/clear-communication-user-guide.pdf)
  emphasizes the main message the audience should remember. Its preference for
  presenting important information early supports a clear opening; the footer
  remains an additional, user-requested reading aid.
- [i-have-adhd](https://github.com/ayghri/i-have-adhd)
  offers practical inspiration for literal language, concrete outcomes and a
  final deletion pass that retains meaningful uncertainty. Its wider interaction
  rules and clinical claims are not adopted. TLDR leaves the body and Asks intact.
- [The Pyramid Method](https://aclanthology.org/N04-1019/)
  evaluates selection of important content while recognizing multiple valid
  summaries. This informs semantic evaluation, not an exact-wording test.
- [Evaluating Factual Consistency](https://aclanthology.org/2020.emnlp-main.750/)
  distinguishes factual consistency from other summary-quality measures. Check
  that the source response supports the footer and that omitted qualifications
  do not change its meaning.

These sources inform design judgment. They do not prove an ideal word count,
that an italic footer is optimal, or a clinical benefit. The personal trial tests
whether this presentation helps its reader.

## Illustrative cases

| Response meaning | Possible footer or omission |
| --- | --- |
| Invoice fix implemented and tested; not released | _**TLDR:** Invoice fix tested; not live yet._ |
| Most payroll rows reconcile; three employees lack overtime | _**TLDR:** Three employees lack overtime; payroll totals remain unreliable._ |
| A cause is suspected; a fix is proposed but unbuilt | _**TLDR:** Suspected cause found; fix proposed, not built._ |
| A quiet, affordable restaurant is recommended; dessert choice is limited | _**TLDR:** Harbor offers a quiet dinner within budget._ |
| A detailed explanation links seasons to Earth's tilt | _**TLDR:** Earth's tilt changes sunlight and day length, causing seasons._ |
| Setup is blocked on account approval, with the request already in Asks | _**TLDR:** Setup awaits account approval._ |
| Plan A fits current small files; Plan B fits growing video storage | _**TLDR:** Choose A for small files; B if video storage grows._ |
| Website live, insurance claim rejected, order two days late | _**TLDR:** Claim rejected; website live; order arriving two days late._ |
| The entire reply asks which account to use | Omit: question only. |
| The entire reply gives the meeting time | Omit: already concise. |
| User requests only valid JSON | Omit: preserve the exact output. |
| A brief condolence draft is presented for copying | Omit when the footer would intrude; never append it inside the draft. |

## Evaluation and refinement

Judge the generated footer against the request and full response:

- Would reading only it create a materially wrong impression?
- Does it reveal an important reason to inspect the full response, when one exists?
- Can anything be removed without losing clarity or important meaning?
- Does it preserve formatting, Asks and exact-output exceptions?

Use an independent sample pass when implementing a meaningful revision. Include
success, blockers, uncertainty, recommendations, explanations, mixed outcomes and
omission cases. A formatting check is useful, but neither a word counter nor an
exact expected sentence can establish semantic quality.

Trial schedules and observations stay in personal configuration and the owning
chat, outside this reusable skill. At the agreed follow-up, privately review a
small available sample and ask whether to retain, refine, remove or propose team
adoption. State evidence gaps; do not claim coverage of unavailable conversations.
Keep the personal skill enabled pending that decision. Remove its activation and
installed links if the user later chooses to stop; preserve the maintained source.
