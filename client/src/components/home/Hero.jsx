
import { useState } from 'react'

function Hero() {
  return (
    <section className="hero">
      <h1>Weekly bonuses for your family, all in one place.</h1>
      <p>
        Check this week's bonus, see who has been paid, and register your
        family to run your own sheet.
      </p>
      <button className="btn btn-primary">Register your family</button>
    </section>
  );
}

export default Hero;