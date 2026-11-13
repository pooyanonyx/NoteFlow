// Moving items from one page to another (pure, so it runs in unit tests; panel.js applies it).
// Which items travel, what happens to what is attached to them, and what is cleaned up:
//   - the items keep EVERYTHING (id, colour, size, text, runs, pressure ...): only the position changes, by the same (dx, dy) for all of them, so their relative positions stay;
//   - a mind-map connector travels with its nodes when BOTH of its nodes travel; a connector with only one end among the moved nodes would point across pages, so it is dropped
//     (the move is one undo step, Undo brings it back); connectors between nodes that stay are untouched;
//   - a text box that is one piece of a text continuing across pages (fl / cont / ns, see flow.js) cannot keep that link once it is on another page: the whole chain is
//     detached into independent text boxes (nothing is lost or changed visually; later edits no longer reflow between them).
import * as M from "./model.js";

const CHAIN = ["fl", "cont", "ns"];
const bare = (d) => { const o = { ...d }; for (const k of CHAIN) delete o[k]; return o; };

/**
 * items: the page's items; idxs: which of them move; (dx, dy): the shift to apply to every moved item.
 * Returns { moved, rest, dropped, detached }:  moved = the items for the new page (in their original order), rest = what stays on the old page, dropped = connectors removed,
 * detached = how many text boxes lost their chain link.
 */
export function transferItems(items, idxs, dx, dy) {
  const set = new Set(idxs), nodeIds = new Set();
  for (const i of set) { const m = M.mindId(items[i]); if (m) nodeIds.add(m); }
  const moved = [], rest = [], dropped = []; const chains = new Set();
  items.forEach((d, i) => {
    const mine = set.has(i);
    if (d.t === "conn") {
      const a = nodeIds.has(d.from), b = nodeIds.has(d.to);
      if (a && b) moved.push(d);                                           // (follows its nodes, even when it was not selected itself)
      else if (a || b || mine) dropped.push(d);
      else rest.push(d);
      return;
    }
    if (mine) { moved.push(M.translate(d, dx, dy)); if (d.fl) chains.add(d.fl); } else rest.push(d);
  });
  let detached = 0;
  const strip = (list) => list.map((d) => { if (d.t === "text" && d.fl && chains.has(d.fl)) { detached++; return bare(d); } return d; });
  return { moved: strip(moved), rest: strip(rest), dropped, detached };
}

/** The ids of the text chains the given items belong to. */
export const chainsOf = (items) => new Set(items.filter((d) => d && d.t === "text" && d.fl).map((d) => d.fl));
/** The list with the chain link removed from every text box of the given chains (the same list when there is nothing to do). Used for the OTHER pages of a notebook too. */
export function detachChains(items, chains) {
  if (!chains.size || !items.some((d) => d.t === "text" && d.fl && chains.has(d.fl))) return items;
  return items.map((d) => (d.t === "text" && d.fl && chains.has(d.fl) ? bare(d) : d));
}
