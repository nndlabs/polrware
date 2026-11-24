import { FormEvent, useEffect, useRef, useState } from 'react';

export type CheckoutLine = { key: string; name: string; size?: string; qty: number; price: number; image: string };

type Props = {
  lines: CheckoutLine[] | null; // null = closed
  onClose: () => void;
  onPaid: () => void;
  formatPrice: (value: number) => string;
};

type Step = 'pay' | 'processing' | 'done';
type Brand = 'visa' | 'mastercard' | 'amex' | '';

const FREE_SHIPPING = 250;
const SHIPPING = 15;
// payment marks from Simple Icons (brand colours)
const LOGO = {
  applepay: 'https://cdn.simpleicons.org/applepay/ffffff',
  googlepay: 'https://cdn.simpleicons.org/googlepay/3c4043',
  paypal: 'https://cdn.simpleicons.org/paypal/003087',
  visa: 'https://cdn.simpleicons.org/visa/1a1f71',
  mastercard: 'https://cdn.simpleicons.org/mastercard/eb001b',
  amex: 'https://cdn.simpleicons.org/americanexpress/2e77bc',
};

const digits = (v: string) => v.replace(/\D/g, '');
function brandOf(d: string): Brand {
  if (/^4/.test(d)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'mastercard';
  if (/^3[47]/.test(d)) return 'amex';
  return '';
}
function luhn(d: string) {
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Demo checkout: wallets and card form, fake processing, confirmation. Nothing is sent anywhere. */
export default function CheckoutModal({ lines, onClose, onPaid, formatPrice }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>('pay');
  const [method, setMethod] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [email, setEmail] = useState('');
  const [card, setCard] = useState('');
  const [name, setName] = useState('');
  const [exp, setExp] = useState('');
  const [cvc, setCvc] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const open = lines !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setStep('pay');
      setErrors({});
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!lines) return <dialog ref={ref} className="checkout-dialog" onClose={onClose} />;

  const subtotal = lines.reduce((t, l) => t + l.price * l.qty, 0);
  const shipping = subtotal >= FREE_SHIPPING ? 0 : SHIPPING;
  const total = subtotal + shipping;
  const brand = brandOf(digits(card));

  const finish = (label: string) => {
    setMethod(label);
    setStep('processing');
    window.setTimeout(() => {
      setOrderNo(`PW-${Math.floor(10000 + Math.random() * 90000)}`);
      setStep('done');
      // card details are never stored: clear them as soon as the demo payment "completes"
      setCard('');
      setCvc('');
      setExp('');
    }, 1500);
  };

  const submitCard = (event: FormEvent) => {
    event.preventDefault();
    const d = digits(card);
    const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) next.email = 'Enter an email address like name@example.com.';
    if (d.length < (brand === 'amex' ? 15 : 13) || !luhn(d)) next.card = 'Enter a valid card number. Try 4242 4242 4242 4242.';
    if (!name.trim()) next.name = 'Enter the name on the card.';
    const m = exp.match(/^(\d{2})\s*\/\s*(\d{2})$/);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) next.exp = 'Use MM / YY.';
    else if (new Date(2000 + Number(m[2]), Number(m[1]), 1) <= new Date()) next.exp = 'This card has expired.';
    if (!new RegExp(`^\\d{${brand === 'amex' ? 4 : 3}}$`).test(cvc)) next.cvc = `Enter the ${brand === 'amex' ? 4 : 3}-digit code.`;
    setErrors(next);
    if (Object.keys(next).length) return;
    const label = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', '': 'card' }[brand];
    finish(`${label} ending ${d.slice(-4)}`);
  };

  const formatCard = (v: string) => {
    const d = digits(v).slice(0, brandOf(digits(v)) === 'amex' ? 15 : 16);
    return brandOf(d) === 'amex' ? [d.slice(0, 4), d.slice(4, 10), d.slice(10)].filter(Boolean).join(' ') : d.replace(/(\d{4})(?=\d)/g, '$1 ');
  };
  const formatExp = (v: string) => {
    const d = digits(v).slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d;
  };

  return (
    <dialog
      ref={ref}
      className="checkout-dialog"
      aria-labelledby="co-title"
      onClose={onClose}
      onClick={(event) => event.target === ref.current && step !== 'processing' && ref.current?.close()}
    >
      <div className="co">
        <aside className="co-summary" aria-label="Order summary">
          <h3>Your order</h3>
          <ul>
            {lines.map((l) => (
              <li key={l.key}>
                <span className="co-thumb">
                  <img src={l.image} alt="" width={56} height={56} />
                  {l.qty > 1 && <b>{l.qty}</b>}
                </span>
                <span className="co-item">
                  {l.name}
                  {l.size && <small>Size {l.size}</small>}
                </span>
                <span>{formatPrice(l.price * l.qty)}</span>
              </li>
            ))}
          </ul>
          <dl>
            <div>
              <dt>Subtotal</dt>
              <dd>{formatPrice(subtotal)}</dd>
            </div>
            <div>
              <dt>Shipping</dt>
              <dd>{shipping ? formatPrice(shipping) : 'Free'}</dd>
            </div>
            <div className="co-total">
              <dt>Total</dt>
              <dd>{formatPrice(total)}</dd>
            </div>
          </dl>
        </aside>

        <div className="co-main">
          <div className="co-head">
            <h2 id="co-title">{step === 'done' ? 'Order confirmed' : 'Checkout'}</h2>
            {step !== 'processing' && (
              <button type="button" className="text-link" autoFocus onClick={() => ref.current?.close()}>
                Close
              </button>
            )}
          </div>
          <p className="co-demo">Demo store: no payment is taken and card details never leave this page.</p>

          {step === 'pay' && (
            <>
              <div className="co-express" role="group" aria-label="Express checkout">
                <button type="button" className="pay-apple" onClick={() => finish('Apple Pay')} aria-label="Pay with Apple Pay">
                  <img src={LOGO.applepay} alt="" />
                </button>
                <button type="button" className="pay-google" onClick={() => finish('Google Pay')} aria-label="Pay with Google Pay">
                  <img src={LOGO.googlepay} alt="" />
                </button>
                <button type="button" className="pay-paypal" onClick={() => finish('PayPal')} aria-label="Pay with PayPal">
                  <img src={LOGO.paypal} alt="" />
                </button>
              </div>
              <p className="co-or">
                <span>or pay with card</span>
              </p>
              <form className="co-form" onSubmit={submitCard} noValidate>
                <label>
                  Email
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={Boolean(errors.email)}
                    placeholder="name@example.com"
                  />
                  {errors.email && <small className="co-err">{errors.email}</small>}
                </label>
                <label>
                  <span className="co-card-label">
                    Card number
                    <span className="co-brands" aria-hidden="true">
                      {(['visa', 'mastercard', 'amex'] as const).map((b) => (
                        <img key={b} src={LOGO[b]} alt="" className={brand && brand !== b ? 'dim' : undefined} />
                      ))}
                    </span>
                  </span>
                  <input
                    name="cc-number"
                    autoComplete="cc-number"
                    inputMode="numeric"
                    value={card}
                    onChange={(e) => setCard(formatCard(e.target.value))}
                    aria-invalid={Boolean(errors.card)}
                    placeholder="1234 1234 1234 1234"
                  />
                  {errors.card && <small className="co-err">{errors.card}</small>}
                </label>
                <label>
                  Name on card
                  <input
                    name="cc-name"
                    autoComplete="cc-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={Boolean(errors.name)}
                  />
                  {errors.name && <small className="co-err">{errors.name}</small>}
                </label>
                <div className="co-row">
                  <label>
                    Expiry
                    <input
                      name="cc-exp"
                      autoComplete="cc-exp"
                      inputMode="numeric"
                      value={exp}
                      onChange={(e) => setExp(formatExp(e.target.value))}
                      aria-invalid={Boolean(errors.exp)}
                      placeholder="MM / YY"
                    />
                    {errors.exp && <small className="co-err">{errors.exp}</small>}
                  </label>
                  <label>
                    CVC
                    <input
                      name="cc-csc"
                      autoComplete="cc-csc"
                      inputMode="numeric"
                      value={cvc}
                      onChange={(e) => setCvc(digits(e.target.value).slice(0, 4))}
                      aria-invalid={Boolean(errors.cvc)}
                      placeholder="123"
                    />
                    {errors.cvc && <small className="co-err">{errors.cvc}</small>}
                  </label>
                </div>
                <button type="submit" className="cta cta-dark co-pay">
                  Pay {formatPrice(total)}
                </button>
              </form>
            </>
          )}

          {step === 'processing' && (
            <div className="co-processing" role="status">
              <span className="co-spinner" aria-hidden="true" />
              <p>Processing your {method} payment…</p>
            </div>
          )}

          {step === 'done' && (
            <div className="co-done" role="status">
              <p className="co-order">Order {orderNo}</p>
              <p>
                {formatPrice(total)} with {method}. In a live store your order would ship within 2 business days.
              </p>
              <p className="co-demo-note">This was a demo: no money moved and nothing was charged.</p>
              <button type="button" className="cta cta-dark" onClick={onPaid}>
                Continue shopping
              </button>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
