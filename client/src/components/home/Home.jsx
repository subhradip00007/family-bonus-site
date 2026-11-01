
import { useState } from 'react'
import Navbar from "../components/Navbar"
import Hero from "./Hero"
import FamilySection from "./FamilySection";

const families = [
  { id: 1, name: "Assassin Family", initials: "AF" },
  { id: 2, name: "Shadow Syndicate", initials: "SS" },
  { id: 3, name: "Crimson Order", initials: "CO" },
  { id: 4, name: "Night Wolves", initials: "NW" },
];


function Home() {
  return (
    <div>
      <Navbar />
      <Hero />
      <FamilySection families={families} />
    </div>
  );
}

export default Home;