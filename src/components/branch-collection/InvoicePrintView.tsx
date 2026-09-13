import { amountToRinggitWords, cardinalWordsLower } from '../../utils/numberToWords';
import type { Brand, InvoiceLineGroup, InvoiceStatus } from '../../types';

export interface InvoicePrintData {
  brand: Brand;
  invoiceNo: string;
  invoiceDate: string;
  clientName: string;
  clientAddress?: string;
  attnName?: string;
  quotationNo?: string;
  contractRef?: string;
  paymentTermsDays: number;
  billingMonth: string;
  lineGroups: InvoiceLineGroup[];
  subTotal: number;
  sstRate: number;
  sstAmount: number;
  total: number;
  /** Who signs this invoice — sourced from the site's Branch at generation time (see Branch's
   *  doc comment in types.ts), not from `brand`: the same brand can be signed for by different
   *  people/titles depending on which branch office issued the invoice. */
  signatoryName?: string;
  signatoryTitle?: string;
  /** When 'void', a cancellation banner is shown instead of the normal totals being trusted at
   *  face value — see voidInvoice()'s doc comment in services/invoices.ts. Optional/untyped-wide
   *  here (rather than required) so a caller building a print preview before an invoice has ever
   *  been saved (InvoiceGenerator) doesn't need to pass a status that doesn't exist yet. */
  status?: InvoiceStatus;
  voidedAt?: number;
  voidedByName?: string;
  voidReason?: string;
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Renders one invoice in the letterhead layout the two sample invoices this feature was modeled
 * on use — brand header/registration numbers, client block, a headcount/rate/days breakdown per
 * location, totals with SST, amount in words, bank details and signature blocks. Used both for a
 * live preview while filling out the generator (before saving) and for viewing/printing a
 * already-saved invoice from the Invoices list — this component never writes anything, it only
 * renders whatever `data` it's given.
 */
function formatVoidDate(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function InvoicePrintView({ data }: { data: InvoicePrintData }) {
  const { brand } = data;
  const displayName = brand.legalName || brand.name;
  const isVoid = data.status === 'void';

  return (
    <div className="bg-white text-slate-900 mx-auto" style={{ maxWidth: '850px', fontSize: '13px', position: 'relative' }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
        }
        @page { margin: 12mm; }
        .inv-table td, .inv-table th { border: 1px solid #cbd5e1; padding: 4px 8px; }
      `}</style>

      {isVoid && (
        <>
          {/* Large rotated watermark over the whole invoice — visible on screen and when printed
              (no .no-print class), so a voided invoice can never be mistaken for a live one even
              from a printed/PDF copy passed around outside the app. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 1,
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                fontSize: '120px',
                fontWeight: 800,
                color: 'rgba(190, 18, 60, 0.18)',
                transform: 'rotate(-28deg)',
                letterSpacing: '0.1em',
                whiteSpace: 'nowrap',
              }}
            >
              VOID
            </span>
          </div>
          <div className="border-2 border-rose-600 bg-rose-50 text-rose-800 rounded-lg px-4 py-2 mb-4" style={{ position: 'relative', zIndex: 2 }}>
            <p className="text-sm font-bold">THIS INVOICE HAS BEEN VOIDED — NOT A VALID DEMAND FOR PAYMENT</p>
            <p className="text-xs mt-0.5">
              {[
                data.voidedByName ? `Voided by ${data.voidedByName}` : null,
                formatVoidDate(data.voidedAt) ? `on ${formatVoidDate(data.voidedAt)}` : null,
              ]
                .filter(Boolean)
                .join(' ')}
              {data.voidReason ? ` — ${data.voidReason}` : ''}
            </p>
          </div>
        </>
      )}

      {/* Logo sits at the left, vertically centered against the company-details column beside
          it. Capped at a fixed height/width (rather than stretched to the column's own height,
          which made a squarish logo balloon far wider than the text next to it) — objectFit
          'contain' + width/height both 'auto' on the OTHER axis keeps whichever dimension isn't
          the limiting one scaled proportionally, so the logo never distorts. */}
      <div className="flex items-center gap-4 border-b-2 border-slate-800 pb-3 mb-4">
        {brand.logoDataUrl && (
          <img
            src={brand.logoDataUrl}
            alt=""
            style={{ maxHeight: '80px', maxWidth: '150px', height: 'auto', width: 'auto', objectFit: 'contain', flexShrink: 0 }}
          />
        )}
        <div className="flex-1 text-center">
          <h1 className="text-xl font-bold uppercase">{displayName}</h1>
          {brand.registrationNo && <p className="text-xs mt-0.5">Company No.: {brand.registrationNo}</p>}
          {brand.address && <p className="text-xs whitespace-pre-line">{brand.address}</p>}
          <p className="text-xs">
            {brand.tel && <>TEL: {brand.tel} </>}
            {brand.fax && <>FAX: {brand.fax}</>}
          </p>
          {brand.serviceTaxNo && <p className="text-xs font-medium">SERVICE TAX NO.: {brand.serviceTaxNo}</p>}
          {brand.tin && <p className="text-xs font-medium">COMPANY TIN: {brand.tin}</p>}
        </div>
      </div>

      <h2 className="text-center text-lg font-bold tracking-wide mb-4">INVOICE</h2>

      <div className="flex justify-between gap-6 mb-3">
        <div>
          <p className="font-medium">To:</p>
          <p className="font-semibold uppercase">{data.clientName}</p>
          {data.clientAddress && <p className="whitespace-pre-line">{data.clientAddress}</p>}
        </div>
        <div className="text-right shrink-0">
          <p>
            <span className="inline-block w-20 text-left">Invoice</span>: {data.invoiceNo}
          </p>
          <p>
            <span className="inline-block w-20 text-left">Date</span>: {formatDate(data.invoiceDate)}
          </p>
        </div>
      </div>

      {data.attnName && <p className="mb-3">Attn. {data.attnName}</p>}

      <table className="inv-table w-full border-collapse mb-4">
        <thead>
          <tr className="bg-slate-50">
            <th className="w-1/3">Quotation No.</th>
            <th className="w-1/3">Contract / Letter of Award / PO No.</th>
            <th>Payment Terms</th>
          </tr>
        </thead>
        <tbody>
          <tr className="text-center">
            <td>{data.quotationNo || '-'}</td>
            <td>{data.contractRef || '-'}</td>
            <td>{data.paymentTermsDays} days</td>
          </tr>
        </tbody>
      </table>

      <table className="inv-table w-full border-collapse mb-1">
        <thead>
          <tr className="bg-slate-50">
            <th className="w-10">NO.</th>
            <th>DESCRIPTION</th>
            <th className="text-right w-32">AMOUNT (RM)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={3} className="align-top">
              <p>
                Being supply of SECURITY GUARD SERVICES for <strong>{data.clientName}</strong> for the
                month of <strong>{data.billingMonth}</strong>
              </p>
            </td>
          </tr>
          {data.lineGroups.map((group, gi) => (
              <tr key={`${group.location}-header-${gi}`}>
                <td className="text-center align-top">{gi + 1}</td>
                <td colSpan={2}>
                  <p className="font-semibold underline">{group.location}</p>
                  <table className="w-full text-xs mt-1">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="font-medium pr-2">HEADCOUNT</th>
                        <th className="font-medium pr-2">RATE</th>
                        <th className="font-medium pr-2">DAYS</th>
                        <th className="font-medium text-right pr-2">AMOUNT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row, ri) => (
                        <tr key={ri}>
                          <td className="pr-2 uppercase">
                            {row.headcount} × {row.category}
                          </td>
                          <td className="pr-2">{row.rate.toFixed(2)}</td>
                          <td className="pr-2">{row.days}</td>
                          <td className="text-right pr-2">{formatMoney(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td>
              </tr>
          ))}
        </tbody>
      </table>

      <table className="inv-table w-full border-collapse mb-3">
        <tbody>
          <tr>
            <td className="w-1/2" rowSpan={4} style={{ verticalAlign: 'top', border: 'none' }} />
            <td className="text-right font-medium">Sub Total</td>
            <td className="text-right w-32">{formatMoney(data.subTotal)}</td>
          </tr>
          <tr>
            <td className="text-right font-medium">LESS</td>
            <td className="text-right">-</td>
          </tr>
          <tr>
            <td className="text-right font-medium">Total (Excluding SST)</td>
            <td className="text-right">{formatMoney(data.subTotal)}</td>
          </tr>
          <tr>
            <td className="text-right font-medium">SST @{Math.round(data.sstRate * 100)}%</td>
            <td className="text-right">{formatMoney(data.sstAmount)}</td>
          </tr>
          <tr>
            <td className="text-right font-bold" style={{ border: 'none' }} />
            <td className="text-right font-bold">Total (Inclusive of SST)</td>
            <td className="text-right font-bold">{formatMoney(data.total)}</td>
          </tr>
        </tbody>
      </table>

      <p className="font-semibold mb-3">{amountToRinggitWords(data.total)}</p>

      <div className="mb-6">
        <p className="font-medium mb-1">Terms and Conditions:</p>
        <ol className="list-decimal pl-5" style={{ lineHeight: 1.5 }}>
          <li>
            Payment is due within {cardinalWordsLower(data.paymentTermsDays)} ({data.paymentTermsDays}) days from
            the date of invoice. A late interest fee of one point five per centum (1.5%) applies after the due
            date.
          </li>
          <li>Any discrepancies should be reported within seven (7) days of receipt.</li>
          <li>Please mention the invoice number when processing payment.</li>
        </ol>
      </div>

      <div className="mb-6">
        <p className="font-medium mb-1">Details of bank as below</p>
        <table>
          <tbody>
            <tr>
              <td className="pr-3 align-top text-slate-500">Account Name</td>
              <td>: {brand.bankAccountName || displayName}</td>
            </tr>
            <tr>
              <td className="pr-3 align-top text-slate-500">Account No.</td>
              <td>: {brand.bankAccountNo || '-'}</td>
            </tr>
            <tr>
              <td className="pr-3 align-top text-slate-500">Name of Bank</td>
              <td>: {brand.bankName || '-'}</td>
            </tr>
            <tr>
              <td className="pr-3 align-top text-slate-500">Address of Bank</td>
              <td className="whitespace-pre-line">: {brand.bankAddress || '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex justify-between gap-6 mt-10">
        <div>
          <p className="mb-8">For {displayName}</p>
          <p className="border-t border-slate-800 pt-1 w-48">AUTHORISED SIGNATURE</p>
          <p>NAME: {data.signatoryName || ''}</p>
          {data.signatoryTitle && <p>TITLE: {data.signatoryTitle}</p>}
          <p>DATE:</p>
        </div>
        <div>
          <p className="mb-8">ACKNOWLEDGED RECEIPT BY:</p>
          <p className="border-t border-slate-800 pt-1 w-48">SIGNATURE &amp; COMPANY STAMP</p>
          <p>NAME:</p>
          <p>DATE:</p>
        </div>
      </div>
    </div>
  );
}
