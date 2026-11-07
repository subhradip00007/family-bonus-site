
import { useEffect, useRef, useState } from 'react'

function Hero() {
  const [contactOpen, setContactOpen] = useState(false);
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!contactOpen) return undefined;
    const trigger = triggerRef.current;
    const dialog = dialogRef.current;
    closeButtonRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") setContactOpen(false);
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll("button, a[href]")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [contactOpen]);

  const emailSubject = encodeURIComponent("Family registration request");
  const emailBody = encodeURIComponent("Hi, I would like to register my family for Family Bonus.\n\nFamily name: \nContact name: ");

  return (
    <section className="hero">
      <h1>Weekly bonuses for your family, all in one place.</h1>
      <p>
        Check this week's bonus, see who has been paid, and register your
        family to run your own sheet.
      </p>
      <button className="btn btn-primary" onClick={(event) => { triggerRef.current = event.currentTarget; setContactOpen(true); }}>Register your family</button>
      {contactOpen && <div className="contact-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setContactOpen(false); }}>
        <section ref={dialogRef} className="contact-modal" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title">
          <button ref={closeButtonRef} className="contact-modal-close" type="button" aria-label="Close contact options" onClick={() => setContactOpen(false)}>×</button>
          <p className="contact-modal-eyebrow">FAMILY BONUS</p>
          <h2 id="contact-modal-title">Register your family</h2>
          <p className="contact-modal-copy">Contact me and I’ll help set up your family bonus sheet.</p>
          <a className="contact-option contact-option-discord" href="https://discord.com/users/1255984736375930920" target="_blank" rel="noopener noreferrer">
            <span className="contact-option-icon" aria-hidden="true">D</span>
            <span><strong>Message on Discord</strong><small>subhradip0871</small></span>
            <span className="contact-option-arrow" aria-hidden="true">↗</span>
          </a>
          <a className="contact-option" href={`mailto:subhradip250@gmail.com?subject=${emailSubject}&body=${emailBody}`}>
            <span className="contact-option-icon contact-option-mail" aria-hidden="true">@</span>
            <span><strong>Send an email</strong><small>subhradip250@gmail.com</small></span>
            <span className="contact-option-arrow" aria-hidden="true">↗</span>
          </a>
        </section>
      </div>}
    </section>
  );
}

export default Hero;
