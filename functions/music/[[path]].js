// /music, /music/artists, /music/albums, /music/songs — THE MUSIC CHARTS (2026-10-21).
//
// The Music tab of the old charts page as a page of its own: the three
// tiers (publisher, album, song) as three charts, switched by the page
// head's underlined tabs. The bare path opens on Artists (Reed's call of
// 2026-08-31, the nav's Music href). The Albums chart is rendered at the
// edge like Shows is; see _shared/charts-page.js.
import { renderShellPage, resolveRoute, notFoundPage } from "../_shared/charts-page.js";
import { headOf } from "../_shared/head.js";

export async function onRequestGet(context) {
  let segs = context.params.path;
  if (segs == null) segs = [];
  if (!Array.isArray(segs)) segs = [segs];
  segs = segs.filter((s) => s !== "");
  const route = segs.length <= 1 ? resolveRoute("music", segs[0]) : null;
  if (!route) return notFoundPage(context);
  return renderShellPage(context, route);
}

export const onRequestHead = headOf(onRequestGet);
