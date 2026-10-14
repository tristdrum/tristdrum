---
name: tldr
description: Distill substantive final replies into a very short, faithful TL;DR footer, including plans, research and structured closeouts. Apply across topics when enabled by personal instructions or explicitly requested; use judgment to skip redundant or intrusive summaries.
---

# TL;DR

Help the reader quickly understand what matters and whether anything deserves
closer attention. Use the shortest wording that preserves the important meaning.
There is no word target or maximum. Usually one short sentence is enough; add
another clause when a material qualification or independent outcome needs it.

## Distill the conclusion

Write the full response first, then:

1. Identify what it establishes relative to the request: an answer, outcome,
   recommendation, explanation or unresolved situation. Summarize that conclusion,
   rather than recounting the work or shortening each section in turn.
2. Preserve anything whose omission would materially mislead the reader about
   completion, consequences, certainty or urgency. A serious unresolved problem
   can be the main takeaway; a minor caveat should not crowd out the answer.
   For mixed reports, preserve independently important outcomes instead of
   collapsing them into a vague overall success or failure.
3. Use everyday words and concrete verbs. Remove process narration, reporting
   phrases such as "has been identified", technical shorthand and details that
   do not change the conclusion. Fragments are fine when their meaning is clear.
4. Read the footer alone. Check that every claim is supported by the response and
   that the important meaning survives. Delete every word or clause that can go
   without losing that meaning or making the line harder to understand.

Keep distinctions such as proposed versus done, tested versus live, and suspected
versus confirmed when they matter. Do not manufacture certainty, reassurance,
urgency or a new recommendation. Name the actual result or problem instead of
using empty pointers such as "see above", "all done" or "issues remain".

## Format and placement

Append one standalone paragraph using exactly this Markdown shape:

```markdown
_**TL;DR:** Summary text._
```

The entire paragraph is italic, with only `TL;DR:` additionally bold. Put it after
the existing response sections, including Asks; Asks remains the last substantive
section, followed by this footer. This is the personal default's explicit exception
to an "Asks last" response convention. Preserve required application metadata and
structured-output boundaries; for a rendered plan, put the footer inside the
plan block. Do not change the surrounding closeout format or remove its evidence.

Leave requests in Asks. A dependency may appear as status, such as "Setup awaits
account approval", without repeating the request or adding a "see Asks" pointer.
Keep sources and supporting links in the body; the footer introduces no new facts.

## When to omit it

Use judgment to skip question-only exchanges, acknowledgements, answers already
as short and informative as a footer, exact-output requests, and situations where
summarizing would intrude on sensitive human communication. Do not omit a useful
summary merely because the response is a plan or a structured closeout.

Apply this to final replies addressed to the user, not progress updates, tool
outputs, or the contents of documents, code, quoted drafts and outgoing messages.
Do not log replies, call extra tools, or invoke another model to produce a footer.
Reuse these instructions once loaded in the conversation.

For maintenance, research and illustrative cases, read
[Design and examples](references/design-and-examples.md). This reference is not
needed to write an ordinary footer.
