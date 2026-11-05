import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import "./BonusViews.css";

const API = "http://localhost:5000/api";
const format = (value) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value || 0);
const dateText = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

function BonusSheet() {
  const { familyId, periodId } = useParams();
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/families/${familyId}/periods/${periodId}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Could not load this sheet");
        return body;
      })
      .then((body) => { if (!cancelled) setSheet(body); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [familyId, periodId]);

  return (
    <div className="bonus-page">
      <Navbar />
      <main className="bonus-container">
        <Link className="bonus-back" to={`/families/${familyId}`}>← Saved periods</Link>
        {error ? <div className="bonus-message" role="alert">{error}</div> : !sheet ? <div className="bonus-message">Loading bonus sheet…</div> : (
          <>
            <header className="bonus-sheet-heading">
              <div className="bonus-sheet-family">{sheet.family.logo ? <img src={sheet.family.logo} alt="" /> : <span className="bonus-family-mark">{sheet.family.name.slice(0, 2).toUpperCase()}</span>}<span>Family Bonus <small>{sheet.family.name}</small></span></div>
              <div className="bonus-period-title"><h1>{sheet.period.name}</h1><p>{dateText(sheet.period.startDate)} – {dateText(sheet.period.endDate)}</p></div>
              <span className="bonus-readonly">PUBLIC · READ ONLY</span>
            </header>
            <section className="bonus-sheet-section">
              <div className="bonus-sheet-caption"><div><h2>Bonus sheet</h2><p>Prices, activity counts, strike deductions, and payout status.</p></div><span>{sheet.playersCount} players</span></div>
              <div className="bonus-table-wrap">
                <table className="bonus-sheet-table">
                  <thead>
                    <tr><th>Player</th>{sheet.events.map((event) => <th key={event.id}>{event.name}</th>)}<th>Strike</th><th>Subtotal</th><th>Deduction</th><th>Payout</th><th>Status</th></tr>
                    <tr className="bonus-price-row"><th>Price per event</th>{sheet.events.map((event) => <th key={event.id}>{format(event.rate)}</th>)}<th>Player’s rate</th><th>—</th><th>—</th><th>—</th><th>—</th></tr>
                  </thead>
                  <tbody>
                    {sheet.players.map((player) => <tr key={player.id}>
                      <td className="bonus-player-cell">{player.name}</td>
                      {sheet.events.map((event) => <td className="bonus-number" key={event.id}>{format(player.counts[event.id])}</td>)}
                      <td>Strike {player.strikePercent ? player.strikePercent / 10 : "—"}{player.strikePercent ? ` · ${player.strikePercent}%` : ""}</td>
                      <td className="bonus-number">{format(player.subtotal)}</td>
                      <td className="bonus-number bonus-deduction">−{format(player.deduction)}</td>
                      <td className="bonus-number bonus-payout">{format(player.payout)}</td>
                      <td><span className={`bonus-paid-state ${player.paidStatus === "Paid" ? "paid" : "pending"}`}>{player.paidStatus}</span></td>
                    </tr>)}
                    {sheet.players.length === 0 && <tr><td colSpan={sheet.events.length + 6} className="bonus-empty-cell">No players were added to this period.</td></tr>}
                  </tbody>
                  <tfoot><tr><th colSpan={sheet.events.length + 4}>Total payout</th><th className="bonus-number bonus-payout">{format(sheet.payoutTotal)}</th><th>—</th></tr></tfoot>
                </table>
              </div>
              <p className="bonus-sheet-foot">Read-only sheet · Last saved {sheet.period.savedAt ? new Date(`${sheet.period.savedAt.replace(" ", "T")}Z`).toLocaleString() : "—"}</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default BonusSheet;
