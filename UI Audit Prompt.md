# UI/UX Design Audit — Agent Prompt

## What We Are Doing

The goal of this review is to **holistically improve the visual design and user experience of this interface** — not to audit it principle by principle. The checklist (`ui-design-checklist.md`) is your reference knowledge base. The principles within it are the lens through which you evaluate the interface. They are not a to-do list to work through sequentially.

Good designers do not fix "visual hierarchy" and then fix "contrast" as separate tasks. They look at the whole interface, identify the underlying problems, and make changes that often address multiple principles at once. That is the approach you will take here.

Attach the interface screenshot or provide the code before beginning.

\---

## Phase 0 — Understand the Interface

Before evaluating anything, build a mental model of what you are looking at. Do not skip this phase.

**1. Purpose and users**

* What is this interface for?
* Who is the primary user and what are they trying to accomplish?
* What is the single most important action the user should be able to take?

**2. Components inventory**

* List the major components present: navigation, buttons, inputs, cards, panels, modals, tables, lists, icons, etc.
* For each component type, note how many distinct visual variants exist (e.g. are there 2 button styles or 5?)

**3. Design tokens — what patterns exist?**

* **Colors:** What colors are repeated? What appears to be the primary/accent color? How many distinct color values are in use?
* **Spacing:** What padding and margin values appear most commonly? Is there a consistent grid or are values arbitrary?
* **Typography:** How many font families are in use? How many distinct font sizes? Is there a clear type hierarchy?
* **Borders and shadows:** What border colors, widths and radius values repeat?

**4. Component hierarchy**

* What is the primary action (the most important button or interaction)?
* What are the secondary actions?
* What are tertiary or utility actions?
* Does the visual weight of these elements match their importance in the hierarchy?

**5. Tech context (if code is provided)**

* What framework or tech stack is being used?
* Are design tokens defined (CSS variables, theme files, constants)?
* Are components reused or are styles repeated inline?

Write a brief summary of your findings from Phase 0 before proceeding.

\---

## Phase 1 — Observe Against the Checklist

Now read through `ui-design-checklist.md`. For each of the 13 principles, assess the interface against the audit checkpoints.

**Important rules for this phase:**

* Record observations only. Do not suggest fixes yet
* Be specific — reference actual elements, colors, sizes and positions rather than speaking generally
* Note both what is working well and what is not
* If a checkpoint does not apply to this interface, note that explicitly rather than skipping it

**Format your observations as:**

```
Principle \\\[number] — \\\[name]
Status: Pass / Needs Work / Fail
Observations:
- \\\[specific observation about a specific element]
- \\\[specific observation about a specific element]
What is working:
- \\\[if anything]
```

Work through all 13 principles. Do not rush this phase — the quality of your synthesis in Phase 2 depends entirely on the quality of your observations here.

\---

## Phase 2 — Synthesise Into Root Problems

Now step back from the individual principles and look across all your observations together.

Your task is to identify the **3 to 6 underlying root problems** in this interface. A root problem is a fundamental design decision (or absence of one) that causes failures across multiple principles simultaneously.

**Ask yourself:**

* Which observations keep pointing to the same underlying cause?
* If I fixed this one thing, how many principle checkboxes would it resolve?
* What is the actual problem — not the symptom?

**Examples of root problems:**

* "There are no design tokens — every color, spacing value and font size is hardcoded independently, making the interface visually inconsistent throughout"
* "The interface has no visual hierarchy — primary and secondary actions are the same size, weight and color, so nothing communicates priority"
* "Color is being used for decoration rather than communication — the accent color appears on backgrounds, data values and borders, leaving no visual signal for interactive elements"
* "The layout reflects the developer's mental model, not the user's workflow — search controls, results and actions are scattered rather than grouped by function"

**Format your root problems as:**

```
Root Problem \\\[number]: \\\[Name]
Description: \\\[One to two sentences explaining the underlying cause]
Affects principles: \\\[list principle numbers]
Evidence: \\\[2–3 specific observations that support this]
```

If two issues you identified are actually the same root problem, merge them. The goal is clarity, not comprehensiveness.

\---

## Phase 3 — Recommend Consolidated Fixes

For each root problem, write one clear, concrete recommendation. This is the deliverable the developer will act on.

**Important rules for this phase:**

* One recommendation per root problem — not one per principle
* Be specific enough that a developer can implement it without asking follow-up questions
* Reference tokens and components by name where possible (from your Phase 0 inventory)
* If a fix requires changes to multiple elements, list them
* After each recommendation, note which principles it addresses and briefly explain why

**Format your recommendations as:**

```
──────────────────────────────────────────
RECOMMENDATION \\\[number]
Root problem addressed: \\\[name from Phase 2]

What to change:
\\\[Specific, actionable description of the change. Include values where relevant —
hex colors, pixel sizes, padding values, component names. If it requires changes
to a token or variable, say so explicitly so the change propagates everywhere.]

Implementation notes:
\\\[Any important context — e.g. "this change affects all button instances",
"define this as a CSS variable before applying", "check this in both mobile
and desktop views"]

Principles addressed:
- Principle \\\[number] — \\\[name]: \\\[one sentence explaining why this fix resolves it]
- Principle \\\[number] — \\\[name]: \\\[one sentence explaining why this fix resolves it]
──────────────────────────────────────────
```

\---

## Phase 4 — Priority Order

After all recommendations are written, order them by impact. Consider:

* Which fix will be most immediately visible to a user?
* Which fix, if done first, makes subsequent fixes easier?
* Which fix addresses the most principles at once?

Present the final priority list as:

```
Priority 1: Recommendation \\\[number] — \\\[name]
Reason: \\\[one sentence on why this is highest priority]

Priority 2: Recommendation \\\[number] — \\\[name]
Reason: \\\[one sentence]

\\\[continue for all recommendations]
```

End with a one-paragraph summary of the overall design direction — what the interface will feel like once all recommendations are implemented, and what the most important shift in design thinking is for the person building it.

\---

## Notes for the Agent

* The checklist is reference material. Read it before evaluating, not during
* Avoid evaluating the same issue twice under different principle names. If you catch yourself doing this, it belongs in Phase 2 as one root problem
* Specificity is more valuable than comprehensiveness. One precise observation about a specific element is worth more than five vague general statements
* If the interface code is provided rather than a screenshot, read the token and component structure in Phase 0 before looking at any visual output
* The goal is not a perfect score on the checklist. The goal is a better interface for the person using it

