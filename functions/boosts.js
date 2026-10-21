// /boosts — THE BOOST FEED, ON ITS OWN PAGE (2026-10-21).
//
// Every boost note as it was published, newest first, Global or Follows,
// with the range and sort its renderer has (boosts-feed.js). It was the
// foot of the Members tab, under the #40HPW boards and the wall, from
// 2026-08-23 to 2026-10-21; Reed's call: readers treat the feed as their
// discovery mechanism (what is being boosted today), so on a discovery
// site it is its own thing. /boosts and /members-* forward
// here from the shell's head script. The shell and the route marking are
// _shared/charts-page.js; the feed hydrates in the browser.
import { renderShellPage, resolveRoute } from "./_shared/charts-page.js";
import { headOf } from "./_shared/head.js";

export async function onRequestGet(context) {
  return renderShellPage(context, resolveRoute("boosts"));
}

export const onRequestHead = headOf(onRequestGet);
