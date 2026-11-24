import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { JacketDetail } from './ProductModal';

const BASE = import.meta.env.BASE_URL;
const CLOTHING = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const Look3D = lazy(() => import('./Look3D'));

type Slot = 'Jackets' | 'Helmets' | 'Boots';
const SLOTS: Slot[] = ['Jackets', 'Helmets', 'Boots'];
const SLOT_LABEL: Record<Slot, string> = { Jackets: 'Jacket', Helmets: 'Helmet', Boots: 'Boots' };

export type LookLine = { item: JacketDetail; size: string };

type Props = {
  open: boolean;
  items: JacketDetail[];
  initialId?: string | null; // open already wearing this product
  onClose: () => void;
  onAddLook: (lines: LookLine[]) => void;
  onBuyLook: (lines: LookLine[]) => void;
  formatPrice: (value: number) => string;
};

const slotOf = (item: JacketDetail): Slot => (item.category === 'Helmets' ? 'Helmets' : item.category === 'Boots' ? 'Boots' : 'Jackets');
const frontImage = (item: JacketDetail) => {
  const front = item.views?.find((v) => v.label === 'Front') ?? item.views?.[0];
  return front ? `${BASE}${front.file}` : `${BASE}rack/${item.id}-cut.webp`;
};
const sizesOf = (item: JacketDetail) => (item.sizeLabels ?? CLOTHING).filter((_, k) => item.sizes[k]);

/** Dress-the-mannequin editor: pick a jacket, helmet and boots, choose sizes, add the set to the bag. */
export default function OutfitBuilder({ open, items, initialId, onClose, onAddLook, onBuyLook, formatPrice }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Slot>('Jackets');
  const [picked, setPicked] = useState<Partial<Record<Slot, string>>>({});
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const bySlot = useMemo(() => {
    const groups: Record<Slot, JacketDetail[]> = { Jackets: [], Helmets: [], Boots: [] };
    items.forEach((item) => groups[slotOf(item)].push(item));
    return groups;
  }, [items]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const start = initialId ? byId.get(initialId) : undefined;
      if (start) {
        const slot = slotOf(start);
        setPicked((p) => ({ ...p, [slot]: start.id }));
        setTab(slot);
      }
    }
    if (!open && dialog.open) dialog.close();
  }, [open, initialId, byId]);

  const wearing = SLOTS.map((slot) => (picked[slot] ? byId.get(picked[slot]!) : undefined));
  const [jacket, helmet, boots] = wearing;
  const lines: LookLine[] = wearing
    .filter((item): item is JacketDetail => Boolean(item))
    .map((item) => ({ item, size: sizes[item.id] ?? sizesOf(item)[0] ?? '' }));
  const total = lines.reduce((t, l) => t + l.item.price, 0);

  const toggle = (item: JacketDetail) => {
    const slot = slotOf(item);
    setPicked((p) => ({ ...p, [slot]: p[slot] === item.id ? undefined : item.id }));
  };
  const shuffle = () => {
    const pick = (list: JacketDetail[]) => list[Math.floor(Math.random() * list.length)]?.id;
    setPicked({ Jackets: pick(bySlot.Jackets), Helmets: pick(bySlot.Helmets), Boots: pick(bySlot.Boots) });
  };

  return (
    <dialog
      ref={ref}
      className="look-dialog"
      aria-labelledby="lk-title"
      onClose={onClose}
      onClick={(event) => event.target === ref.current && ref.current?.close()}
    >
      <div className="lk">
        <div className="lk-stage-wrap">
          <div className="lk-stage">
            <Suspense fallback={<p className="lk-loading">Setting up the mannequin…</p>}>
              <Look3D
                jacket={jacket}
                helmet={helmet}
                boots={boots}
                label={lines.length ? `3D mannequin wearing ${lines.map((l) => l.item.name).join(', ')}. Drag to turn.` : '3D mannequin. Drag to turn.'}
              />
            </Suspense>
            <p className="lk-hint">Drag to turn</p>
          </div>
          <div className="lk-tools">
            <button type="button" className="text-link" onClick={shuffle}>
              Shuffle
            </button>
            <button type="button" className="text-link" onClick={() => setPicked({})} disabled={!lines.length}>
              Clear
            </button>
          </div>
        </div>

        <div className="lk-panel">
          <div className="lk-head">
            <h2 id="lk-title">Build a look</h2>
            <button type="button" className="text-link" autoFocus onClick={() => ref.current?.close()}>
              Close
            </button>
          </div>

          <div className="lk-tabs" role="tablist" aria-label="Choose what to add">
            {SLOTS.map((slot) => (
              <button
                key={slot}
                type="button"
                role="tab"
                aria-selected={tab === slot}
                aria-controls={`lk-grid-${slot}`}
                onClick={() => setTab(slot)}
              >
                {slot} <span>{bySlot[slot].length}</span>
              </button>
            ))}
          </div>

          <ul className="lk-grid" id={`lk-grid-${tab}`} role="tabpanel" aria-label={tab}>
            {bySlot[tab].map((item) => {
              const on = picked[tab] === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={on ? 'on' : undefined}
                    aria-pressed={on}
                    onClick={() => toggle(item)}
                    title={`${item.name}, ${formatPrice(item.price)}`}
                  >
                    <img src={frontImage(item)} alt="" loading="lazy" />
                    <span className="sr-only">
                      {on ? 'Remove' : 'Wear'} {item.name}, {formatPrice(item.price)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="lk-summary">
            <h3>Your look</h3>
            {lines.length === 0 ? (
              <p className="lk-empty">Pick a jacket, a helmet and boots to dress the mannequin.</p>
            ) : (
              <ul className="lk-lines">
                {SLOTS.map((slot, k) => {
                  const item = wearing[k];
                  if (!item) return null;
                  const options = sizesOf(item);
                  return (
                    <li key={slot}>
                      <span className="lk-slot">{SLOT_LABEL[slot]}</span>
                      <span className="lk-name">{item.name}</span>
                      <label className="sr-only" htmlFor={`lk-size-${slot}`}>
                        Size for {item.name}
                      </label>
                      <select
                        id={`lk-size-${slot}`}
                        value={sizes[item.id] ?? options[0] ?? ''}
                        onChange={(e) => setSizes((s) => ({ ...s, [item.id]: e.target.value }))}
                      >
                        {options.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <span className="lk-price">{formatPrice(item.price)}</span>
                      <button type="button" className="lk-remove" aria-label={`Remove ${item.name}`} onClick={() => toggle(item)}>
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="lk-total">
              <span>Total</span>
              <strong>{formatPrice(total)}</strong>
            </div>
            <div className="lk-actions">
              <button type="button" className="cta cta-dark" disabled={!lines.length} onClick={() => onAddLook(lines)}>
                Add look to bag
              </button>
              <button type="button" className="cta pd-buy" disabled={!lines.length} onClick={() => onBuyLook(lines)}>
                Buy this look
              </button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}
