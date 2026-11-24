import { useEffect, useRef, useState } from 'react';
import type { RackItem } from './Rack';

export type ProductView = { label: string; file: string; w: number; h: number };

export type JacketDetail = RackItem & {
  description: string;
  features: string[];
  fit: string;
  sizes: number[];
  sizeLabels?: string[]; // defaults to clothing sizes
  views?: ProductView[]; // explicit views (helmets: front, side, back); jackets derive front/back
  category?: string;
};

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export function viewsOf(item: JacketDetail): ProductView[] {
  if (item.views?.length) return item.views;
  const front = { label: 'Front', file: `rack/${item.id}-cut.webp`, w: item.w, h: item.h };
  return item.back ? [front, { label: 'Back', file: `rack/${item.id}-back-cut.webp`, w: item.w, h: item.h }] : [front];
}
const BASE = import.meta.env.BASE_URL;

type Props = {
  items: JacketDetail[];
  index: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onAdd: (item: JacketDetail, size: string) => void;
  onBuyNow: (item: JacketDetail, size: string) => void;
  onSizeGuide: () => void;
  formatPrice: (value: number) => string;
};

/** One product window, filled with whichever jacket is open: image (front/back), details, sizes, add to bag. */
export default function ProductModal({ items, index, onClose, onNavigate, onAdd, onBuyNow, onSizeGuide, formatPrice }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState(0);
  const [size, setSize] = useState('');
  const [hint, setHint] = useState('');
  const item = index === null ? null : items[index];
  const count = items.length;

  // open / close the native dialog to match the selected product
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
  }, [item]);

  // a fresh state for every product
  useEffect(() => {
    setView(0);
    setSize('');
    setHint('');
  }, [index]);

  // arrow keys browse the collection while the window is open
  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'ArrowRight') onNavigate((index + 1) % count);
      if (event.key === 'ArrowLeft') onNavigate((index - 1 + count) % count);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, count, onNavigate]);

  const withSize = (action: (item: JacketDetail, size: string) => void) => {
    if (!item) return;
    if (!size) {
      setHint('Pick a size first.');
      return;
    }
    action(item, size);
    setHint('');
  };

  const prev = index === null ? 0 : (index - 1 + count) % count;
  const next = index === null ? 0 : (index + 1) % count;

  return (
    <dialog
      ref={ref}
      className="product-dialog"
      aria-labelledby="pd-title"
      onClose={onClose}
      onClick={(event) => event.target === ref.current && ref.current?.close()}
    >
      {item && index !== null && (
        <div className="pd">
          <div className="pd-media">
            {(() => {
              const views = viewsOf(item);
              const v = views[Math.min(view, views.length - 1)];
              return (
                <>
                  <img
                    key={`${item.id}-${v.label}`}
                    src={`${BASE}${v.file}`}
                    alt={`${item.name}, ${v.label.toLowerCase()} view`}
                    width={v.w}
                    height={v.h}
                    className={item.category === 'Helmets' ? 'is-gear' : undefined}
                  />
                  {views.length > 1 && (
                    <div className="pd-views" role="group" aria-label="Choose a view">
                      {views.map((option, k) => (
                        <button key={option.label} type="button" aria-pressed={view === k} onClick={() => setView(k)}>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          <div className="pd-info">
            <div className="pd-top">
              <span className="pd-count">
                {String(index + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
              </span>
              <div className="pd-nav">
                <button type="button" aria-label={`Previous: ${items[prev].name}`} onClick={() => onNavigate(prev)}>
                  <span aria-hidden="true">←</span>
                </button>
                <button type="button" aria-label={`Next: ${items[next].name}`} onClick={() => onNavigate(next)}>
                  <span aria-hidden="true">→</span>
                </button>
                <button type="button" className="text-link" autoFocus onClick={() => ref.current?.close()}>
                  Close
                </button>
              </div>
            </div>

            <h2 id="pd-title">{item.name}</h2>
            <p className="pd-price">
              {formatPrice(item.price)} <span>{item.material}</span>
            </p>
            <p className="pd-desc">{item.description}</p>
            <ul className="pd-features" aria-label="Features">
              {item.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>

            <fieldset className="pd-sizes">
              <legend>
                <span>Size</span>
                <button type="button" className="text-link" onClick={onSizeGuide}>
                  Size guide
                </button>
              </legend>
              <div>
                {(item.sizeLabels ?? SIZES).map((s, k) => {
                  const inStock = Boolean(item.sizes[k]);
                  return (
                    <label key={s} className={inStock ? undefined : 'out'}>
                      <input
                        type="radio"
                        name="pd-size"
                        value={s}
                        disabled={!inStock}
                        checked={size === s}
                        onChange={() => {
                          setSize(s);
                          setHint('');
                        }}
                      />
                      <span>
                        {s}
                        {!inStock && <span className="sr-only"> sold out</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <p className="pd-fit">{item.fit}</p>

            <div className="pd-actions">
              <button type="button" className="cta cta-dark pd-add" onClick={() => withSize(onAdd)}>
                Add to bag · {formatPrice(item.price)}
              </button>
              <button type="button" className="cta pd-buy" onClick={() => withSize(onBuyNow)}>
                Buy now
              </button>
            </div>
            <p className="pd-hint" aria-live="polite">
              {hint}
            </p>
          </div>
        </div>
      )}
    </dialog>
  );
}
