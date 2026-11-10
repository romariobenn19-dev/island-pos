# Island POS

Simple point of sale, stock and credit book for Caribbean shops. First version is set up for Barbados (BBD, 17.5% VAT included in prices, US$ at 2:1, cash rounded to 5¢).

- Works offline: everything is stored on the device; install it from the browser like an app.
- Sell: search (understands everyday names and typos: "sweet drink", "corn beef", "sardeens"), barcode scan with the phone camera, cash / US$ / card / credit, change calculated, WhatsApp receipts.
- Items: starter list of 164 common Barbados items, receive stock by the case with cost per case or unit, suggested selling price from your markup.
- Credit book: who owes what, limits, payments, WhatsApp reminders.
- Reports: sales, profit, VAT, payment types, best sellers, running low.
- Backup / restore to a file.

```bash
npm install
npm run dev      # local development
npm test         # logic tests
npm run build    # production build in dist/
```
