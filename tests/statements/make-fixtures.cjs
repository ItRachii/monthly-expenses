// Prints the two synthetic statements to PDF with Chromium. They carry fake
// personal details on purpose, so run.ts can prove none of it survives the
// pipeline. Needs Playwright on the path:
//   node tests/statements/make-fixtures.cjs
// Then lock a copy with pypdf (python3 -m pip install pypdf):
//   python3 -c "from pypdf import PdfReader, PdfWriter; r=PdfReader('tests/statements/fixtures/hdfc.pdf'); w=PdfWriter(); [w.add_page(p) for p in r.pages]; w.encrypt(user_password='RACH0705', owner_password='owner', algorithm='RC4-128'); w.write(open('tests/statements/fixtures/hdfc-locked.pdf','wb'))"
const { chromium } = require("playwright");
const fs = require("fs");
const out = process.argv[2] || __dirname + "/fixtures";

const css = `
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #111; margin: 28px; }
  h1 { font-size: 16px; margin: 0 0 6px; }
  h2 { font-size: 12px; margin: 16px 0 4px; }
  .cols { display: flex; justify-content: space-between; gap: 30px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 3px 6px; text-align: left; vertical-align: top; }
  th { border-bottom: 1px solid #333; font-size: 9.5px; }
  td.r, th.r { text-align: right; }
  .small { font-size: 9px; color: #444; }
`;

const hdfc = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<h1>HDFC BANK &nbsp; Credit Card Statement</h1>
<div class="cols">
  <div>
    <div><b>Name:</b> RACHIT AWASTHI</div>
    <div>Flat 12, Sunrise Residency, 4th Cross, Indiranagar</div>
    <div>Bengaluru 560038, Karnataka</div>
    <div>Email: rachit.awasthi@gmail.com &nbsp; Mobile: 9876543210</div>
    <div>PAN: ABCDE1234F</div>
  </div>
  <div>
    <div><b>Statement Date:</b> 12/08/2026</div>
    <div><b>Payment Due Date:</b> 01/09/2026</div>
    <div><b>Card No:</b> 4695 XXXX XXXX 1234</div>
    <div class="small">Account: 50100234567890</div>
  </div>
</div>
<table style="margin-top:10px">
  <tr><th>Credit Limit</th><th>Available Credit Limit</th><th>Available Cash Limit</th><th>Total Dues</th><th>Minimum Amount Due</th></tr>
  <tr><td>3,00,000.00</td><td>2,52,681.58</td><td>60,000.00</td><td>47,318.42</td><td>2,365.92</td></tr>
</table>
<p class="small">Convert your purchases into EMI. Call 18002026161 or visit our website.</p>

<h2>Domestic Transactions</h2>
<table>
  <tr><th>Date</th><th>Transaction Description</th><th class="r">Feature Reward Points</th><th class="r">Amount (in Rs.)</th></tr>
  <tr><td>02/07/2026</td><td>SWIGGY BANGALORE</td><td class="r">4</td><td class="r">456.00</td></tr>
  <tr><td>03/07/2026</td><td>AMAZON PAY INDIA PVT LTD MUMBAI</td><td class="r">12</td><td class="r">2,499.00</td></tr>
  <tr><td>05/07/2026</td><td>PAYMENT RECEIVED - THANK YOU</td><td class="r">0</td><td class="r">30,000.00 Cr</td></tr>
  <tr><td>06/07/2026</td><td>IGST-VPS2607123456789012</td><td class="r">0</td><td class="r">11.04</td></tr>
  <tr><td>08/07/2026</td><td>EMI PRINCIPAL AMT 4 OF 12 CROMA</td><td class="r">0</td><td class="r">4,166.67</td></tr>
  <tr><td>08/07/2026</td><td>EMI INTEREST AMT 4 OF 12 CROMA</td><td class="r">0</td><td class="r">612.50</td></tr>
  <tr><td>08/07/2026</td><td>IGST-VPS2607987654321098</td><td class="r">0</td><td class="r">110.25</td></tr>
  <tr><td>10/07/2026</td><td>LATE PAYMENT FEE</td><td class="r">0</td><td class="r">500.00</td></tr>
  <tr><td>10/07/2026</td><td>IGST-VPS2607111122223333</td><td class="r">0</td><td class="r">90.00</td></tr>
  <tr><td>11/07/2026</td><td>UBER INDIA SYSTEMS PVT LTD</td><td class="r">1</td><td class="r">312.00</td></tr>
  <tr><td>15/07/2026</td><td>NETFLIX COM MUMBAI</td><td class="r">2</td><td class="r">649.00</td></tr>
</table>

<h2>International Transactions</h2>
<table>
  <tr><th>Date</th><th>Transaction Description</th><th class="r">Amount in Foreign Currency</th><th class="r">Amount (in Rs.)</th></tr>
  <tr><td>04/07/2026</td><td>OPENAI CHATGPT SUBSCR SAN FRANCISCO</td><td class="r">USD 20.00</td><td class="r">1,752.40</td></tr>
  <tr><td>04/07/2026</td><td>CROSS CURRENCY MARKUP FEE</td><td class="r"></td><td class="r">61.33</td></tr>
  <tr><td>18/07/2026</td><td>AIRBNB PAYMENTS LUXEMBOURG</td><td class="r">EUR 140.00</td><td class="r">13,377.00</td></tr>
</table>
<p class="small">For queries call 18002026161 or write to cardservices@hdfcbank.com quoting card 4695 1234 5678 1234.</p>
</body></html>`;

const icici = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<h1>ICICI Bank Credit Card Statement</h1>
<div class="cols">
  <div>
    <div>MR RACHIT AWASTHI</div>
    <div>Flat 12, Sunrise Residency, Indiranagar, Bengaluru 560038</div>
    <div>Mobile: +91 98765 43210 &nbsp; Email: rachit.awasthi@gmail.com</div>
  </div>
  <div>
    <div><b>Card Number:</b> 4375XXXXXXXX9012</div>
    <div><b>Statement Date:</b> August 12, 2026</div>
    <div><b>Payment Due Date:</b> September 1, 2026</div>
    <div><b>Total Amount Due:</b> Rs. 33,691.60</div>
  </div>
</div>

<h2>Transaction Details</h2>
<table>
  <tr><th>Date</th><th>SerNo.</th><th>Transaction Details</th><th class="r">Reward Points</th><th class="r">Intl.# amount</th><th class="r">Amount (in Rs.)</th></tr>
  <tr><td>12/07/2026</td><td>10921307256</td><td>AMAZON PAY INDIA PRIVATE LI</td><td class="r">12</td><td></td><td class="r">1,234.00</td></tr>
  <tr><td>14/07/2026</td><td>10925553122</td><td>OPENAI *CHATGPT SUBSCR</td><td class="r">0</td><td class="r">20.00 USD</td><td class="r">1,760.30</td></tr>
  <tr><td>14/07/2026</td><td>10925553123</td><td>MARKUP FEE</td><td class="r">0</td><td></td><td class="r">61.61</td></tr>
  <tr><td>14/07/2026</td><td>10925553124</td><td>IGST ON MARKUP FEE</td><td class="r">0</td><td></td><td class="r">11.09</td></tr>
  <tr><td>16/07/2026</td><td>10925553125</td><td>BIGBASKET BANGALORE</td><td class="r">5</td><td></td><td class="r">2,010.00</td></tr>
  <tr><td>18/07/2026</td><td>10925553126</td><td>EMI PRINCIPAL 3/12 FLIPKART</td><td class="r">0</td><td></td><td class="r">3,000.00</td></tr>
  <tr><td>18/07/2026</td><td>10925553127</td><td>EMI INTEREST 3/12 FLIPKART</td><td class="r">0</td><td></td><td class="r">420.00</td></tr>
  <tr><td>18/07/2026</td><td>10925553128</td><td>IGST ON EMI INTEREST</td><td class="r">0</td><td></td><td class="r">75.60</td></tr>
  <tr><td>20/07/2026</td><td>10925553129</td><td>BBPS PAYMENT RECEIVED</td><td class="r">0</td><td></td><td class="r">25,000.00 CR</td></tr>
  <tr><td>22/07/2026</td><td>10925553130</td><td>APOLLO PHARMACY KORAMANGALA</td><td class="r">3</td><td></td><td class="r">845.50</td></tr>
  <tr><td>25/07/2026</td><td>10925553131</td><td>BOOKING.COM AMSTERDAM</td><td class="r">0</td><td class="r">85.50 EUR</td><td class="r">8,170.28</td></tr>
</table>
<p class="small">Contact 18001080 or customer.care@icicibank.com. Reference: 4375 1234 5678 9012.</p>
</body></html>`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [name, html] of [["hdfc", hdfc], ["icici", icici]]) {
    await p.setContent(html);
    await p.pdf({ path: `${out}/${name}.pdf`, format: "A4", printBackground: false });
    console.log("wrote", `${out}/${name}.pdf`, fs.statSync(`${out}/${name}.pdf`).size, "bytes");
  }
  await b.close();
})();
