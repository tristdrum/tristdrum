/** @typedef {{type: 'send_message', threadId: string, body: string} | {type: 'set_calendar_day', unitNumber: 1 | 2 | 3, date: string, available: boolean} | {type: 'modify_reservation', confirmationCode: string, checkIn: string, checkOut: string} | {type: 'cancel_reservation', confirmationCode: string}} AirbnbAction */

/** @param {AirbnbAction} _action */
export async function performAirbnbAction(_action) {
  return { accepted: false, reason: "READ_ONLY_PILOT" };
}
