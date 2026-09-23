/** Waiter order lines spoken when the player sits at a table. */
export const ORDER_LINES: Record<string, string> = {
  'che-cau-nguyet':
    'Anh đang ở cầu Nguyệt, ở đây có một quán chè rất nà ngon. Ai bản lĩnh đến anh mời các em cốc chè. Ăn xong anh cảm ơn các em rồi về. Anh nói thế các em tự hiểu...',
  'ga-nguyen-con':
    'Các em cứ thử luộc đúng một con gà lên, không cần chặt, các em để nó nguội xong các em ngồi xé, hai vợ chồng xé và những đứa con nhỏ mà các cháu nó không ăn được thì các em xé nhỏ đút cho các cháu ăn. Xong hai vợ chồng em ăn bằng một con gà luộc lên không chặt ra mà sẽ xé ở trên mâm, các em ăn cảm thấy ngon và thú vị như thế nào. Đấy là nói thật...',
  'home-tan-binh':
    'Chúng mày thích đến 66b nguyễn sỹ sách phường 15 tân bình a mời mâm cơm nhỏ hạnh phúc to , với con người của a nó là như vậy',
  'ktv-corner': 'Nói ít thôi hết bao tiền trả, Lên',
  'mat-xa-nguoi-mu':
    'Chơi gì thì chơi không được chơi đá, chơi cỏ, chơi kẹo, chơi ke...',
  'bun-chi-rau':
    'Thế là đủ rồi, không ăn nữa. Anh chỉ ăn từng này với một tí bún nữa là xong.',
}

/** Locations where chủ + nhân viên are female. */
export const FEMALE_STAFF_IDS = new Set(['ktv-corner', 'mat-xa-nguoi-mu'])

export function getOrderLine(locationId: string): string | null {
  return ORDER_LINES[locationId] ?? null
}
