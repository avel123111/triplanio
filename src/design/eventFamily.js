// @ts-check
// Event type → colour family (Lumo `--ev-*` triads). Single source used by the
// timeline plate (`StreamEventRow`), the calendar `EventChip`, and anywhere an
// event needs its family colour. Lives in its own module so leaf primitives
// (EventChip) can import it without a cycle through the design barrel.
export function eventFamily(type) {
  if (type === "flight" || type === "transfer") return "transfer";
  if (type === "hotel-checkin" || type === "hotel-checkout") return "hotel";
  if (type === "hotel-deadline") return "deadline";
  if (type === "car-pickup" || type === "car-return") return "car";
  return "activity";
}
