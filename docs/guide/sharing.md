# Share a link

> Share this with the client.

Claude checks the work, puts the prototypes on a private site, and writes you a handover message. Each person signs in with their own link.

## The first time

Claude needs three things from you, once per project.

1. **A Vercel account.** Sign up free at [vercel.com](https://vercel.com). Claude then gives you a sign-in link. Open it, choose **Allow**, and Claude carries on by itself. No Terminal.
2. **The people store.** It keeps who can sign in and their comments. Vercel asks you to accept its terms in your browser, once per team. Claude gives you the link; if Vercel lists several Upstash products, pick **Upstash for Redis**. See [Comments](comments.md).
3. **How long access lasts.** Three months, six months, or open-ended. It is the default for everyone on the client's side, and you can change it for one person later.

Claude then gives you your own link. You are the first Studio person.

## What reviewers see

Someone who opens the site without signing in sees a short page that says to open the link they were sent. Their link shows who it is for and a **Continue** button; after it: the **Prototypes** page, each prototype they may see, each walkthrough, and **Controls**. Nothing else is on the site, and search engines are kept out.

## Which prototypes a client sees

Every prototype starts **Internal**: only your studio can open it. When one is ready for the client, open the **Prototypes** page on the shared site and turn on the switch beside it; it is then **Client-facing**, and clients see it listed and can open it. Turn the switch off and it is internal again, for everyone, at once. A client never receives an internal prototype's page, code, text or images: it is not hidden on their screen, the site refuses it.

## What a client can change

A client-facing prototype still keeps its controls inside the studio until you share them.

- **Dials.** Open **Controls** on the prototype. Beside each dial is an eye. A dim, struck eye means internal: the client's panel does not have that dial, and the prototype uses its starting value. Click the eye and it turns bright: the client has the dial. Click again to take it back. The **View** tools (theme, reduce motion, speed), where a prototype has them, have no eye: a client always has them.
- **Variants.** At the end of the picker is an eye. Click it, then click each variant the client should be able to flip between; a green dot marks them. Click **Done**. With one variant marked the client sees that one and no picker. With none marked they see the first.

Both are kept on the shared site, like the prototype's own switch, and apply to every client at once. To see the prototype as a client gets it, open **Controls** and press **Client view** at the bottom. The page loads again as a client's: the eyes are gone, and only the shared dials and variants remain. A note at the top says Client view is on; press **Leave** on it, or **Leave Client view** in Controls, to go back. A prototype that is still internal shows as missing there, as it does for a client. Only your studio has this; a client never sees it.

An internal dial is left out of the client's panel, not out of the page: its name can still be found in the page's code by someone who looks. Do not put anything secret in a dial's name.

Walkthroughs are the exception: every walkthrough, and every feature's name, reaches everyone signed in, clients included, whatever the switches say. Do not write about internal work in a walkthrough until the client may see it.

**Client view**, at the top of the **Prototypes** page, shows the page exactly as a client gets it. A note at the bottom says Client view is on; press **Leave** to go back. It is the same Client view as the comments' and the one in a prototype's **Controls**, so turning it on in one place turns it on in the others.

The switches on your own computer (while you work with Claude, before sharing) only change that computer's copy. The shared site keeps its own: set them there.

After the update that brought this, every prototype is internal again until you switch it on: check the switches before you send a link.

## What to send

Add each person in the People tab, or ask Claude:

> Add Dana from Acme as a client.

Switch on the prototypes the client should see first. Then send each person their own link, with Claude's handover message: which prototype to open first, where the walkthrough is, and that **Controls** is the round button at the top. Never send one person's link to someone else: whoever opens it first signs in as that person.

## What a client does with their link

They open it and press **Continue**. That signs in the device they are on, and it stays signed in until their access ends. The link then stops working, so a used link opens nothing. Until it is used, whoever opens it first signs in as that person, so send it only to them. An unused link lasts 14 days.

## Getting back in

- **Another device**, such as a phone as well as a laptop: they ask you for a new link. Press **New link** on their row in the People tab, or ask Claude: "A new link for Dana." Their other devices stay signed in.
- **A link that stopped working**, or that they lost: the same, a new link.
- **A lost or shared device:** press **Sign out everywhere** on their row. Every device they had signs out within five minutes, and you get one new link to send.
- **Their access ended:** change their access on their row, then send a new link.

## Updating the link

Every time you say **share**, the same site shows the latest work. Everyone stays signed in.
