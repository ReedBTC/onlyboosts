// /podcasts, /podcasts/shows, /podcasts/episodes — THE PODCAST CHARTS (2026-10-21).
//
// The Podcasts tab of the old charts page as a page of its own: the Shows
// chart and the Episodes chart, switched by the page head's underlined
// tabs, with the chart box (scope, range, language, sort) as it was. The
// bare path opens on Shows, the nav's and the footer's Podcasts href. The
// shell, the route marking and the Shows feed's edge render are
// _shared/charts-page.js; anything else under /podcasts is a 404.
import { renderShellPage, resolveRoute, notFoundPage } from "../_shared/charts-page.js";
import { headOf } from "../_shared/head.js";

export async function onRequestGet(context) {
  let segs = context.params.path;
  if (segs == null) segs = [];
  if (!Array.isArray(segs)) segs = [segs];
  segs = segs.filter((s) => s !== "");
  const route = segs.length <= 1 ? resolveRoute("podcasts", segs[0]) : null;
  if (!route) return notFoundPage(context);
  return renderShellPage(context, route);
}

export const onRequestHead = headOf(onRequestGet);
