# Comments

Everyone on a shared site is a named person who signed in with their own link, so every comment says who wrote it.

## Turn comments on

> Turn on comments.

The first time, Vercel asks you to accept the comment store's terms in your browser; Claude gives you the link. If it lists several Upstash products, choose **Install** on **Upstash for Redis**, accept, and close any step that offers to create a database: Claude creates it. Claude then updates the site and gives you your own sign-in link. You are the first Studio person.

## Studio and Client

Every person is one of two kinds. Your team are **Studio**; the people you make the work for are **Client**.

Both comment, reply, edit what they wrote, and resolve or reopen any thread they can see. A Client can delete only their own comments. Studio can also delete anyone's, sort comments by kind and state, and add and remove people.

## Internal and client-facing

Every thread is either **internal** or **client-facing**, and it stays that way: nothing switches it later.

- A thread a Client starts is client-facing. Everyone sees it, and Studio's replies in it are seen by the client too.
- A thread Studio starts is internal unless Studio picks **Client-facing** on the new comment. Only Studio sees an internal thread and its replies. A client is never sent one: it is not hidden on their screen, it never reaches their browser at all.
- To tell the client something from an internal thread, write a new client-facing comment. The internal one stays inside the studio.

Studio sees every thread. The card of each one says **Internal** or **Client-facing** beside its number, and an internal pin is amber. Internal and client-facing threads are numbered apart, each from 1, so a client's numbers have no gaps where an internal thread sits. The amber tells an internal 2 from a client-facing 2; in `comments.md` the internal one is written **I2**. **⋯** and **Show** narrow the list to **Internal** or **Client-facing**; **All** brings everything back. While the list is narrowed, a note over the bar says **Internal only** or **Client-facing only**, and **Show all** on it brings every thread back. The count on the round button always counts every open thread, so a narrowed list never hides one. A client sees none of these words: every thread they see is one they may see.

## Client view

**⋯** and **Client view** show the comments exactly as a client gets them: only client-facing threads, with Studio's controls out of the way. Use it to check what a client will read before a presentation. A note over the bar says Client view is on; press **Leave** on it, or **⋯** and **Leave Client view**, to go back. A comment you write in Client view is client-facing. That browser remembers Client view until you leave it. It is also at the bottom of **Controls** on every prototype. It covers the **Prototypes** page too: there it lists only the client-facing prototypes (see [Share a link](sharing.md)).

## Add someone

On the site, press the round comments button, then **⋯** and **People**. Enter their name, their team (your studio, or the client's company), their kind (**Client**, or **Studio** for your own team) and how long their access lasts. **Default** is the project's length for a client, and open-ended for Studio. Copy the link and send it to them.

Each link is for one person and signs in one device, then stops working. When they open it, the page says who it is for; they press **Continue** and they are in. For a second device, press **New link** on their row and send that one. An unused link lasts 14 days.

Or say it:

> Add Dana from Acme as a client.

## Leave a comment

Press the round comments button at the edge of the screen. It turns light: you are commenting. Click the part of the page you mean, write the comment and press Enter. The toggle on the bar switches between **Pin** (a comment on one part of the page) and **Page** (a comment on the page as a whole). Press the button again, **×** on the bar or Esc to stop.

While you are commenting, each comment is a numbered pin on the page. A thread keeps its number for good: deleting one moves no other, and a number is never given twice. So a client, who does not see the internal threads, may see gaps (1, 3, 4); that is expected. A pin opens its thread in a card beside it; the arrows on the bar step from one thread to the next. Anyone can reply, and anyone can **Resolve** a thread and **Reopen** it. A resolved pin turns pale and shows a check; **⋯** and **Show resolved** bring them back on the page.

On a phone, tap instead of click. The bar sits along the bottom edge in place of the button, and a thread opens as a sheet from the bottom: drag it down to close it.

A comment remembers exactly what you were looking at, including every Controls setting. **⋯** and **Show its state** on a thread bring that view back.

The button can sit anywhere along the edge: drag it and it settles in the nearest corner or side, or move it with Alt and an arrow key. **⋯** and **Hide comments** tuck it away; the small tab left at the edge brings it back. Both are remembered in that browser.

## Work from the comments

> What did the client say?

Claude pulls the comments into the project, sorts them by state and kind, acts on each one, resolves the ones it handled, and lists the ones that need your decision. Then say **share** again so the site shows the changes.

## Remove someone

> Revoke Dana's access.

Their links stop working at once, and every device they signed in on is signed out within five minutes. Or press **Revoke** on their row in the People tab.

To sign them out of every device but keep them, press **Sign out everywhere**: their devices are signed out within five minutes, and you get one new link to send. To change how long they keep access, press **Access** and choose a length; it counts from today, and their signed-in devices follow within five minutes.
