/* /hpw/<week>: the verbs. The board is in the document (functions/hpw/
 * [[path]].js rendered it); this attaches the share control to it. */
import { mountShare } from '/assets/js/hpw-share.js?v=ob-v154'

const page = document.querySelector('[data-hpw-page]')
const board = page?.querySelector('.hpw-board')
if (page && board) {
  const key = page.dataset.hpwPage
  const title = board.querySelector('.hpw-pick')?.textContent?.trim()
    || board.querySelector('.hpw-title')?.firstChild?.textContent?.trim()
    || key
  mountShare(board, { key, title })
}
