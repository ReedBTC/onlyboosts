// /members — THE MEMBERS PAGE (2026-10-21).
//
// What the Members tab held once the #40HPW boards went to the Charts page
// and the boost feed to /boosts: the membership sentence, the Top Members
// wall with its four orderings, and the Boost Bots section, all painted by
// members-board.js's renderMembersWall in the browser (feeds.js, off
// body[data-page]). No feed is activated on this page. The shell and the
// route marking are _shared/charts-page.js.
import { renderShellPage, resolveRoute } from "./_shared/charts-page.js";
import { headOf } from "./_shared/head.js";

export async function onRequestGet(context) {
  return renderShellPage(context, resolveRoute("members"));
}

export const onRequestHead = headOf(onRequestGet);
