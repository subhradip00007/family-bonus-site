function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (typeof value !== "number" && /^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function filePart(value) {
  return String(value || "sheet")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "sheet";
}

export function downloadBonusSheet(sheet) {
  const events = sheet.events || [];
  const players = sheet.players || [];
  const trailingColumns = ["Strike", "Subtotal", "Deduction", "Payout", "Status"];
  const rows = [
    ["Family", sheet.family?.name || ""],
    ["Period", sheet.period?.name || ""],
    ["Start date", sheet.period?.startDate || ""],
    ["End date", sheet.period?.endDate || ""],
    [],
    ["Price per event", ...events.map((event) => Number(event.rate) || 0), ...trailingColumns.map(() => "")],
    ["Player", ...events.map((event) => event.name), ...trailingColumns],
    ...players.map((player) => {
      const eventCounts = events.map((event) => Number(player.counts?.[event.id ?? event.clientId] || 0));
      const subtotal = player.subtotal ?? events.reduce((sum, event, index) => sum + (Number(event.rate) || 0) * eventCounts[index], 0);
      const deduction = player.deduction ?? subtotal * (Number(player.strikePercent) || 0) / 100;
      const payout = player.payout ?? subtotal - deduction;
      const strike = Number(player.strikePercent) ? `${Number(player.strikePercent)}%` : "None";
      return [player.name, ...eventCounts, strike, subtotal, deduction, payout, player.paidStatus || "Pending"];
    }),
    ["Total payout", ...events.map(() => ""), ...trailingColumns.slice(0, 3).map(() => ""), Number(sheet.payoutTotal ?? players.reduce((sum, player) => {
      const subtotal = player.subtotal ?? events.reduce((rowSum, event) => rowSum + (Number(event.rate) || 0) * (Number(player.counts?.[event.id ?? event.clientId]) || 0), 0);
      const deduction = player.deduction ?? subtotal * (Number(player.strikePercent) || 0) / 100;
      return sum + (player.payout ?? subtotal - deduction);
    }, 0)) || 0, ""],
  ];

  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const family = filePart(sheet.family?.name);
  const period = filePart(sheet.period?.name);
  link.href = url;
  link.download = `family-bonus-${family}-${period}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
