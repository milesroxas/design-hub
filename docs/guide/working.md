# Work with Claude

Open Claude Code in your project folder. Everything below is something you say to Claude.

## Ask for a prototype

Name the feature and the question it should answer.

> Make a prototype of the checkout. The question is whether one page or three steps feels faster.

Claude creates the prototype, writes a short description of its states, builds it, and tells you where to open it.

Prototypes are deliberately plain: real structure and real behaviour, placeholder polish. That keeps them quick to make and keeps reviewers talking about the flow, not the colours. Ask for polish only when the flow is settled.

## Open it

Click **Open Design Hub** on the Design Hub page, or open the address Claude gives you. The **Prototypes** page lists every prototype in the project. Click one. A new prototype appears there on its own; no restart needed.

## Controls

At the top of every prototype is a round button, **Controls**. It opens the dials: every state Claude built, such as empty, loading, the longest names, dark mode and slow motion. A reviewer who never opens Controls sees one state. Say so when you share.

## Walkthroughs

A feature can have a walkthrough: a page that explains the prototype and links straight into its states. They are listed under **Walkthroughs** on the Prototypes page.

> Write the walkthrough for checkout.

## Change things

Say what you want, in plain words.

> Make the empty state friendlier.
> Try a version with the summary on the left.

Claude changes the prototype, adds a state, or makes a second prototype, and tells you which.

## Where things live

Everything is in your project folder. Claude keeps it in order; you never need to open these.

| Folder | What is in it |
| --- | --- |
| `prototypes` | One folder per prototype. |
| `docs` | Design notes, walkthroughs and pulled comments, per feature. |
| `DESIGN.md`, `PRODUCT.md` | The recorded design rules, and who the product is for. |
