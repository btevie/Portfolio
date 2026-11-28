import { aiExtractInvoice } from "./billAuditor";

async function runTest() {
  const fakeMessyBill = `
    DATE,CODE,DESC,AMT
    2026-11-01,SVC-01,Monthly Fiber Internet,79.99
    2026-11-01,REG-REC,Regulatory Cost Recovery Fee,14.50
    2026-11-01,EQP-RNT,Modem/Router Maintenance Surcharge,15.00
    2026-11-01,SVC-01,Monthly Fiber Internet,79.99
    2026-11-01,ADM-FEE,Paperless Billing Admin Fee,4.95
  `;

  console.log("Auditing bill...");
  const result = await aiExtractInvoice(fakeMessyBill, "csv");
  console.log(JSON.stringify(result, null, 2));
}

runTest();
