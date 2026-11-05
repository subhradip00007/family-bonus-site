import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./App.css";
import Home from "./components/home/Home";
import Login from "./components/login/Login";
import Username from "./components/login/Username";
import DevAdmin from "./components/devAdmin/DevAdmin";
import FamilyPeriods from "./components/bonus/FamilyPeriods";
import BonusSheet from "./components/bonus/BonusSheet";
import FamilyAdmin from "./components/bonus/FamilyAdmin";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/username" element={<Username />} />
        <Route path="/dev-admin" element={<DevAdmin />} />
        <Route path="/families/:familyId" element={<FamilyPeriods />} />
        <Route path="/families/:familyId/periods/:periodId" element={<BonusSheet />} />
        <Route path="/family-admin/:familyId" element={<FamilyAdmin />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
