import {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
} from 'react';
import hero900 from './assets/hero-900.webp';
import hero1600 from './assets/hero-1600.webp';
import editorial1000 from './assets/editorial-1000.webp';
import editorial2000 from './assets/editorial-2000.webp';
import rackCatalog from './rack-catalog.json';
import ProductModal, { type JacketDetail } from './ProductModal';
import gearCatalog from './gear-catalog.json';
import CheckoutModal, { type CheckoutLine } from './CheckoutModal';
import OutfitBuilder, { type LookLine } from './OutfitBuilder';

const BASE = import.meta.env.BASE_URL;

// The 3D rail (three.js) loads in its own chunk so the rest of the page stays light.
const Rack = lazy(() => import('./Rack'));

type Product = {
  name: string;
  type: string;
  price: number;
  image: string;
  category: string;
  cutout?: boolean; // transparent product cutout rather than a photo
  altImage?: string; // second angle shown on hover
};

// 3D tilt toward the pointer on product images (writes CSS variables, no re-render)
const tilt = (event: ReactPointerEvent<HTMLElement>) => {
  if (event.pointerType !== 'mouse') return;
  const el = event.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (event.clientX - r.left) / r.width - 0.5;
  const y = (event.clientY - r.top) / r.height - 0.5;
  el.style.setProperty('--ry', `${(x * 18).toFixed(2)}deg`);
  el.style.setProperty('--rx', `${(-y * 14).toFixed(2)}deg`);
};
const untilt = (event: ReactPointerEvent<HTMLElement>) => {
  event.currentTarget.style.setProperty('--ry', '0deg');
  event.currentTarget.style.setProperty('--rx', '0deg');
};

type BagLine = { name: string; size?: string; qty: number };
const lineKey = (line: BagLine) => `${line.name}|${line.size ?? ''}`;
type InfoKey = 'repairs' | 'size' | 'privacy' | 'fieldnote';

const otherProducts: Product[] = [];


const navLinks = [
  { id: 'shop', label: 'Shop' },
  { id: 'helmets', label: 'Helmets' },
  { id: 'boots', label: 'Boots' },
  { id: 'campaign', label: 'Campaign' },
  { id: 'story', label: 'Our story' },
  { id: 'footer', label: 'Contact' },
];

const stores = [
  { city: 'Tromsø', lines: ['Strandgata 12', '9008 Tromsø', 'Norway'] },
  { city: 'Oslo', lines: ['Markveien 35', '0554 Oslo', 'Norway'] },
  { city: 'Stockholm', lines: ['Norrlandsgatan 18', '111 43 Stockholm', 'Sweden'] },
];

// TODO: replace with the brand's real profile URLs before launch.
const socials = [
  { short: 'Ig', label: 'Instagram', href: 'https://www.instagram.com/polrware/' },
  { short: 'Pi', label: 'Pinterest', href: 'https://www.pinterest.com/polrware/' },
  { short: 'Ar', label: 'Are.na', href: 'https://www.are.na/polrware' },
];

const sizeRows = [
  ['XS', '84-89', '70-75'],
  ['S', '90-95', '76-81'],
  ['M', '96-101', '82-87'],
  ['L', '102-107', '88-93'],
  ['XL', '108-114', '94-100'],
];

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const MAX_QTY = 9;
const BAG_KEY = 'polrware-bag';
const EMAIL = 'hello@polrware.com';

const info: Record<InfoKey, { title: string; body: ReactNode }> = {
  repairs: {
    title: 'Lifetime repairs',
    body: (
      <>
        <p>
          Every Polrware piece comes with free repairs for as long as you own it: broken zips, torn
          seams, worn cuffs and lost buttons.
        </p>
        <p>
          Bring it to one of our stores in Tromsø, Oslo or Stockholm, or email{' '}
          <a href={`mailto:${EMAIL}`}>{EMAIL}</a> and we will arrange shipping.
        </p>
      </>
    ),
  },
  size: {
    title: 'Size guide',
    body: (
      <>
        <p>
          Our jackets are cut with room for a fleece underneath. If you are between two sizes, take
          the larger one.
        </p>
        <table className="size-table">
          <caption className="sr-only">Body measurements in centimetres</caption>
          <thead>
            <tr>
              <th scope="col">Size</th>
              <th scope="col">Chest (cm)</th>
              <th scope="col">Waist (cm)</th>
            </tr>
          </thead>
          <tbody>
            {sizeRows.map(([size, chest, waist]) => (
              <tr key={size}>
                <th scope="row">{size}</th>
                <td>{chest}</td>
                <td>{waist}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ),
  },
  privacy: {
    title: 'Privacy statement',
    body: (
      <>
        <p>
          We only use your email address to send field notes and release news. We never sell or
          share it.
        </p>
        <p>
          Every email has an unsubscribe link, and you can ask us to delete your data at any time
          by writing to <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
        </p>
      </>
    ),
  },
  fieldnote: {
    title: 'Above the weather',
    body: (
      <>
        <p>
          We shot the Winter 2026 campaign in the Lyngen Alps, where December daylight lasts only a
          few hours and the wind decides the schedule.
        </p>
        <p>
          The crew wore the collection from the early approach to the last frame on the ridge.
          Anything that did not keep them warm did not make the final line.
        </p>
      </>
    ),
  },
};

const Arrow = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M3 10h13M11 5l5 5-5 5" />
  </svg>
);

const rackItems = rackCatalog as JacketDetail[];
const rackProducts: Product[] = rackItems.map((item) => ({
  name: item.name,
  type: item.material,
  price: item.price,
  image: `${BASE}rack/${item.id}-cut.webp`,
  category: 'Jackets',
  cutout: true,
}));

// helmets: shop grid and product window only (they don't hang on the rail)
const gearItems = gearCatalog as JacketDetail[];
const gearProducts: Product[] = gearItems.map((item) => ({
  name: item.name,
  type: item.material,
  price: item.price,
  image: `${BASE}${item.views?.[0].file ?? ''}`,
  altImage: item.views?.[1] ? `${BASE}${item.views[1].file}` : undefined,
  category: item.category ?? 'Gear',
  cutout: true,
}));
// everything that has a product window
const detailItems: JacketDetail[] = [...rackItems, ...gearItems];

// shop grid: every jacket on the rail, then helmets, then the layers and accessories
const products: Product[] = [...rackProducts, ...gearProducts, ...otherProducts];
// filters only for categories that actually have pieces; the row hides when there is just one
const categories = ['All', ...Array.from(new Set(products.map((product) => product.category)))];

const productByName = (name: string) => products.find((product) => product.name === name);

function loadBag(): BagLine[] {
  try {
    const saved = JSON.parse(localStorage.getItem(BAG_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((line) => line && productByName(line.name) && Number(line.qty) > 0)
      .map((line) => ({
        name: line.name,
        size: typeof line.size === 'string' ? line.size : undefined,
        qty: Math.min(MAX_QTY, Math.floor(Number(line.qty))),
      }));
  } catch {
    return [];
  }
}

export default function App() {
  const [activeCategory, setActiveCategory] = useState('All');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [bag, setBag] = useState<BagLine[]>(loadBag);
  const [bagOpen, setBagOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState('home');
  const [subscribed, setSubscribed] = useState(false);
  const [toast, setToast] = useState('');
  const [checkoutNote, setCheckoutNote] = useState(false);
  const [infoKey, setInfoKey] = useState<InfoKey | null>(null);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [rackNear, setRackNear] = useState(false);
  const rackSectionRef = useRef<HTMLElement>(null);
  const [checkoutLines, setCheckoutLines] = useState<CheckoutLine[] | null>(null);
  const [checkoutFromBag, setCheckoutFromBag] = useState(false);
  const [lookOpen, setLookOpen] = useState(false);
  const [lookStart, setLookStart] = useState<string | null>(null);

  const navRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const bagButtonRef = useRef<HTMLButtonElement>(null);
  const bagCloseRef = useRef<HTMLButtonElement>(null);
  const bagPanelRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const filteredProducts =
    activeCategory === 'All'
      ? products
      : products.filter((product) => product.category === activeCategory);
  // shop grid split into labelled groups (Jackets, Helmets...) so every category is easy to find
  const shopGroups = categories
    .filter((category) => category !== 'All')
    .map((category) => ({
      category,
      id: category.toLowerCase(),
      items: filteredProducts.filter((product) => product.category === category),
    }))
    .filter((group) => group.items.length > 0);
  const bagCount = bag.reduce((total, line) => total + line.qty, 0);
  const subtotal = bag.reduce(
    (total, line) => total + (productByName(line.name)?.price ?? 0) * line.qty,
    0,
  );

  // Keep the bag between visits.
  useEffect(() => {
    try {
      localStorage.setItem(BAG_KEY, JSON.stringify(bag));
    } catch {
      /* storage blocked: the bag still works for this visit */
    }
  }, [bag]);

  // Compact the nav once the top of the hero scrolls away.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Highlight the nav link for the section in view.
  useEffect(() => {
    const sections = ['home', ...navLinks.map((link) => link.id)]
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActiveSection(entry.target.id);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  // Mobile menu: close on Escape or a tap outside, and whenever the layout switches to desktop.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 900px)');
    const onChange = () => desktop.matches && setMenuOpen(false);
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, []);

  // Bag drawer: lock page scroll, move focus in, close on Escape, hand focus back on close.
  useEffect(() => {
    if (!bagOpen) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => bagCloseRef.current?.focus(), 60);
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setBagOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      root.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      bagButtonRef.current?.focus();
    };
  }, [bagOpen]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const showToast = (message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3400);
  };

  const toggleFavorite = (name: string) => {
    setFavorites((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  const addToBag = (name: string, size?: string) => {
    const key = `${name}|${size ?? ''}`;
    setBag((current) => {
      const existing = current.find((line) => lineKey(line) === key);
      return existing
        ? current.map((line) => (lineKey(line) === key ? { ...line, qty: Math.min(MAX_QTY, line.qty + 1) } : line))
        : [...current, { name, size, qty: 1 }];
    });
    setCheckoutNote(false);
    showToast(`${name}${size ? `, size ${size},` : ''} added to your bag.`);
  };

  const checkoutLine = (name: string, size: string | undefined, qty: number): CheckoutLine | null => {
    const product = productByName(name);
    return product ? { key: `${name}|${size ?? ''}`, name, size, qty, price: product.price, image: product.image } : null;
  };

  const startCheckoutFromBag = () => {
    const lines = bag.map((l) => checkoutLine(l.name, l.size, l.qty)).filter((l): l is CheckoutLine => l !== null);
    if (!lines.length) return;
    setBagOpen(false);
    setCheckoutFromBag(true);
    setCheckoutLines(lines);
  };

  const openLook = (startId: string | null = null) => {
    setViewIndex(null);
    setLookStart(startId);
    setLookOpen(true);
  };

  const addLook = (lines: LookLine[]) => {
    setBag((current) => {
      let next = [...current];
      for (const { item, size } of lines) {
        const key = `${item.name}|${size}`;
        const existing = next.find((line) => lineKey(line) === key);
        next = existing
          ? next.map((line) => (lineKey(line) === key ? { ...line, qty: Math.min(MAX_QTY, line.qty + 1) } : line))
          : [...next, { name: item.name, size, qty: 1 }];
      }
      return next;
    });
    showToast(`Your look (${lines.length} ${lines.length === 1 ? 'piece' : 'pieces'}) was added to your bag.`);
  };

  const buyLook = (lines: LookLine[]) => {
    const checkout = lines
      .map(({ item, size }) => checkoutLine(item.name, size, 1))
      .filter((l): l is CheckoutLine => l !== null);
    if (!checkout.length) return;
    setLookOpen(false);
    setCheckoutFromBag(false);
    setCheckoutLines(checkout);
  };

  const buyNow = (name: string, size: string) => {
    const line = checkoutLine(name, size, 1);
    if (!line) return;
    setViewIndex(null);
    setCheckoutFromBag(false);
    setCheckoutLines([line]);
  };

  // start loading the 3D rail one screen before it scrolls into view
  useEffect(() => {
    const el = rackSectionRef.current;
    if (!el || rackNear) return;
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && setRackNear(true), { rootMargin: '100% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [rackNear]);

  // scroll reveal: elements marked data-reveal rise into place the first time they enter the viewport
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)'));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el) => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [activeCategory]);

  const openProduct = (name: string) => {
    const i = detailItems.findIndex((item) => item.name === name);
    if (i >= 0) setViewIndex(i);
  };

  const setQty = (key: string, qty: number) => {
    setBag((current) =>
      qty <= 0
        ? current.filter((line) => lineKey(line) !== key)
        : current.map((line) => (lineKey(line) === key ? { ...line, qty: Math.min(MAX_QTY, qty) } : line)),
    );
  };

  const openBag = () => {
    setMenuOpen(false);
    setToast('');
    setBagOpen(true);
  };

  const openInfo = (key: InfoKey) => {
    setInfoKey(key);
    requestAnimationFrame(() => dialogRef.current?.showModal());
  };

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !bagPanelRef.current) return;
    const focusable = Array.from(
      bagPanelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submitNewsletter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubscribed(true);
  };

  const mapsUrl = (lines: string[]) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Polrware, ${lines.join(', ')}`)}`;

  return (
    <>
      <a className="skip-link" href="#story">
        Skip to content
      </a>

      <header
        ref={navRef}
        className={`site-nav ${scrolled ? 'is-scrolled' : ''} ${menuOpen ? 'is-open' : ''}`}
      >
        <button type="button" className="nav-chip" onClick={() => openInfo('repairs')}>
          Free lifetime repairs
        </button>
        <nav className="nav-bar" aria-label="Main navigation">
          <a className="nav-brand" href="#home" onClick={() => setMenuOpen(false)}>
            <span className="nav-mark" aria-hidden="true">
              P
            </span>
            <span className="nav-word">Polrware</span>
          </a>
          <ul className="nav-links" id="nav-links">
            {navLinks.map((link) => (
              <li key={link.id}>
                <a
                  href={`#${link.id}`}
                  aria-current={activeSection === link.id ? 'true' : undefined}
                  onClick={(event) => {
                    setMenuOpen(false);
                    const group = categories.find((c) => c.toLowerCase() === link.id);
                    if (group && activeCategory !== 'All' && activeCategory !== group) {
                      // that category's grid is hidden by the current filter: show it, then jump to it
                      event.preventDefault();
                      setActiveCategory('All');
                      requestAnimationFrame(() => document.getElementById(link.id)?.scrollIntoView());
                    }
                  }}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <button
            ref={bagButtonRef}
            className="nav-bag"
            type="button"
            onClick={openBag}
            aria-haspopup="dialog"
            aria-label={`Bag, ${bagCount} ${bagCount === 1 ? 'item' : 'items'}`}
          >
            Bag <b aria-hidden="true">{bagCount}</b>
          </button>
          <button
            ref={menuButtonRef}
            className="menu-button"
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="nav-links"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
          </button>
        </nav>
        <a className="nav-chip nav-chip-end" href={`mailto:${EMAIL}`}>
          {EMAIL}
        </a>
      </header>

      <main>
        <section className="hero" id="home">
          <div ref={sentinelRef} className="nav-sentinel" aria-hidden="true" />
          <div className="hero-copy">
            <p className="eyebrow">Born above the tree line, 68° N</p>
            <h1>
              Built for the
              <br />
              <em>cold ahead.</em>
            </h1>
            <p className="hero-intro">
              Winter essentials engineered for deep cold,{' '}
              <br />
              long miles and everything after.
            </p>
            <div className="hero-ctas">
              <a className="cta cta-dark" href="#shop">
                Explore the collection <Arrow />
              </a>
              <button type="button" className="cta cta-ghost" onClick={() => openLook()}>
                Build a look
              </button>
            </div>
          </div>

          <div className="hero-image-wrap">
            <div className="hero-stamp" aria-hidden="true">
              <span>−20°C</span>
              <span>tested</span>
            </div>
            <img
              src={hero1600}
              srcSet={`${hero900} 900w, ${hero1600} 1024w`}
              sizes="(max-width: 900px) 100vw, 54vw"
              alt="Model wearing Polrware black winter outerwear in the snow"
              width={1024}
              height={1280}
              fetchPriority="high"
              decoding="async"
            />
          </div>
        </section>

        <section className="intro" id="story" aria-label="The rail" data-rack-track ref={rackSectionRef}>
          <div className="intro-sticky">
          <div className="intro-rack">
            <Suspense fallback={<div className="rack-stage" />}>
              {rackNear ? (
              <Rack
                items={rackItems}
                onAdd={(item) => addToBag(item.name)}
                onPick={(item) => openProduct(item.name)}
                activeId={viewIndex !== null ? detailItems[viewIndex].id : null}
                formatPrice={(value) => money.format(value)}
              />
              ) : (
                <div className="rack-stage" />
              )}
            </Suspense>
          </div>
          </div>
        </section>

        <section className="shop" id="shop">
          <header className="section-header">
            <h2 data-reveal>Cold, considered.</h2>
            <button type="button" className="cta cta-dark" onClick={() => openLook()}>
              Build a look <Arrow />
            </button>
          </header>

          {categories.length > 2 && (
          <div className="filter-row" role="group" aria-label="Filter products">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={activeCategory === category ? 'active' : ''}
                aria-pressed={activeCategory === category}
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
          )}

          {shopGroups.map((group) => (
            <div className="shop-group" id={group.id} key={group.category}>
              {shopGroups.length > 1 || group.category !== 'Jackets' ? (
                <h3 className="shop-group-title" data-reveal>
                  {group.category} <span>{group.items.length}</span>
                </h3>
              ) : null}
              <div className="product-grid">
                {group.items.map((product, index) => (
                  <article
                    className="product-card"
                    key={product.name}
                    data-reveal
                    style={{ '--d': `${(index % 4) * 80}ms` } as CSSProperties}
                  >
                    <div className="product-image">
                      <span className="product-number">{String(index + 1).padStart(2, '0')}</span>
                      <button
                        type="button"
                        className={`favorite ${favorites.includes(product.name) ? 'active' : ''}`}
                        onClick={() => toggleFavorite(product.name)}
                        aria-pressed={favorites.includes(product.name)}
                        aria-label={`Save ${product.name}`}
                      >
                        <span aria-hidden="true">{favorites.includes(product.name) ? '♥' : '♡'}</span>
                      </button>
                      <button
                        type="button"
                        className={`product-open${product.altImage ? ' has-alt' : ''}`}
                        onClick={() => openProduct(product.name)}
                        onPointerMove={product.cutout ? tilt : undefined}
                        onPointerLeave={product.cutout ? untilt : undefined}
                        aria-label={`View ${product.name}`}
                      >
                        <img
                          className={product.cutout ? 'is-cutout' : undefined}
                          src={product.image}
                          alt=""
                          loading="lazy"
                          width={1000}
                          height={1250}
                        />
                        {product.altImage && (
                          <img className="is-cutout alt" src={product.altImage} alt="" loading="lazy" width={1000} height={1250} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="quick-add"
                        onClick={() => addToBag(product.name)}
                        aria-label={`Add ${product.name} to bag`}
                      >
                        Quick add <span aria-hidden="true">+</span>
                      </button>
                    </div>
                    <div className="product-info">
                      <div>
                        <h3>{product.name}</h3>
                        <p>{product.type}</p>
                      </div>
                      <strong>{money.format(product.price)}</strong>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="campaign" id="campaign">
          <img
            src={editorial2000}
            srcSet={`${editorial1000} 1000w, ${editorial2000} 1536w`}
            sizes="100vw"
            alt="Polrware silver puffer campaign in the mountains"
            width={1536}
            height={1024}
            loading="lazy"
            decoding="async"
          />
          <div className="campaign-overlay" />
          <div className="campaign-top">
            <span>Lyngen Alps, Norway</span>
          </div>
          <div className="campaign-copy" data-reveal>
            <p>Winter 2026 campaign</p>
            <h2>
              Above the
              <br />
              weather.
            </h2>
            <button className="cta cta-light" type="button" onClick={() => openInfo('fieldnote')}>
              Read field note <Arrow />
            </button>
          </div>
        </section>

        <section className="values">
          <h2 className="values-title" data-reveal>Designed to endure.</h2>
          <div className="value-grid">
            <article data-reveal>
              <span>01</span>
              <h3>Made for cold</h3>
              <p>Every layer is field-tested in real northern winters, down to −20°C.</p>
            </article>
            <article data-reveal>
              <span>02</span>
              <h3>Lower impact</h3>
              <p>Recycled insulation and traceable fabrics, chosen to last beyond seasons.</p>
            </article>
            <article data-reveal>
              <span>03</span>
              <h3>Repair, repeat</h3>
              <p>Lifetime repairs keep dependable gear outside and away from landfill.</p>
            </article>
          </div>
        </section>
      </main>

      <footer id="footer">
        <div className="footer-card" data-reveal>
          <div className="footer-top">
            <div className="footer-signup">
              <h2>{subscribed ? 'You’re on the list.' : 'Winter in your mailbox'}</h2>
              <p aria-live="polite">
                {subscribed
                  ? 'Field notes and future releases are heading your way.'
                  : 'Early access, field notes and cold-weather forecasts.'}
              </p>
              {!subscribed && (
                <>
                  <form id="footer-newsletter" onSubmit={submitNewsletter}>
                    <label className="sr-only" htmlFor="footer-email">
                      Email address
                    </label>
                    <input
                      id="footer-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      spellCheck={false}
                      placeholder="name@example.com…"
                      required
                    />
                    <button type="submit">Send</button>
                  </form>
                  <div className="footer-consent">
                    <input id="footer-consent" name="consent" type="checkbox" required form="footer-newsletter" />
                    <label htmlFor="footer-consent">I agree to the</label>
                    <button type="button" className="text-link" onClick={() => openInfo('privacy')}>
                      privacy statement
                    </button>
                  </div>
                </>
              )}
            </div>
            <a className="footer-logo" href="#home" aria-label="Polrware, back to top">
              POLR
              <span>WARE</span>
            </a>
          </div>

          <div className="footer-directory">
            <div className="footer-links">
              <div>
                <h3>Shop</h3>
                <a href="#shop" onClick={() => setActiveCategory('All')}>
                  New arrivals
                </a>
                <a href="#shop" onClick={() => setActiveCategory('Jackets')}>
                  Jackets
                </a>
                <a href="#campaign">Field notes</a>
              </div>
              <div>
                <h3>Help</h3>
                <a href="#story">Our story</a>
                <button type="button" onClick={() => openInfo('repairs')}>
                  Repairs
                </button>
                <button type="button" onClick={() => openInfo('size')}>
                  Size guide
                </button>
              </div>
            </div>

            {stores.map((store) => (
              <address key={store.city}>
                <h3>Polrware {store.city}</h3>
                <p>
                  {store.lines.map((line, i) => (
                    <span key={line}>
                      {line}
                      {i < store.lines.length - 1 && <br />}
                    </span>
                  ))}
                </p>
                <a
                  className="route-link"
                  href={mapsUrl(store.lines)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Route to Polrware ${store.city} (opens Google Maps)`}
                >
                  Route <Arrow />
                </a>
              </address>
            ))}
          </div>

          <div className="footer-bottom">
            <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
            <span>© {new Date().getFullYear()} Polrware</span>
            <div className="social-links">
              {socials.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${social.label} (opens in a new tab)`}
                >
                  {social.short}
                </a>
              ))}
            </div>
            <button type="button" className="text-link" onClick={() => openInfo('privacy')}>
              Privacy policy
            </button>
          </div>
        </div>
      </footer>

      <div className={`toast ${toast ? 'on' : ''}`} role="status" aria-live="polite">
        {toast && (
          <>
            <span>{toast}</span>
            <button type="button" onClick={openBag}>
              View bag
            </button>
          </>
        )}
      </div>

      <div className={`bag-scrim ${bagOpen ? 'on' : ''}`} onClick={() => setBagOpen(false)} aria-hidden="true" />
      <aside
        ref={bagPanelRef}
        className={`bag ${bagOpen ? 'on' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bag-title"
        inert={!bagOpen}
        onKeyDown={trapFocus}
      >
        <div className="bag-head">
          <h2 id="bag-title">Your bag</h2>
          <button ref={bagCloseRef} type="button" className="text-link" onClick={() => setBagOpen(false)}>
            Close
          </button>
        </div>

        {bag.length === 0 ? (
          <div className="bag-empty">
            <p>Your bag is empty.</p>
            <a className="cta cta-dark" href="#shop" onClick={() => setBagOpen(false)}>
              Explore the collection <Arrow />
            </a>
          </div>
        ) : (
          <>
            <ul className="bag-lines">
              {bag.map((line) => {
                const product = productByName(line.name);
                if (!product) return null;
                return (
                  <li key={lineKey(line)}>
                    <img src={product.image} alt="" width={72} height={90} />
                    <div>
                      <h3>{product.name}</h3>
                      <p>
                        {product.type}
                        {line.size && ` · Size ${line.size}`}
                      </p>
                      <div className="qty" role="group" aria-label={`Quantity of ${product.name}`}>
                        <button
                          type="button"
                          aria-label="Remove one"
                          onClick={() => setQty(lineKey(line), line.qty - 1)}
                        >
                          −
                        </button>
                        <output>{line.qty}</output>
                        <button
                          type="button"
                          aria-label="Add one"
                          disabled={line.qty >= MAX_QTY}
                          onClick={() => setQty(lineKey(line), line.qty + 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="bag-line-end">
                      <strong>{money.format(product.price * line.qty)}</strong>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => setQty(lineKey(line), 0)}
                        aria-label={`Remove ${product.name} from bag`}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="bag-foot">
              <div className="bag-total">
                <span>Subtotal</span>
                <strong>{money.format(subtotal)}</strong>
              </div>
              <p>Shipping and taxes are calculated at checkout.</p>
              <button type="button" className="cta cta-dark bag-checkout" onClick={startCheckoutFromBag}>
                Checkout <Arrow />
              </button>
            </div>
          </>
        )}
      </aside>

      <dialog
        ref={dialogRef}
        className="info-dialog"
        aria-labelledby="info-title"
        onClose={() => setInfoKey(null)}
        onClick={(event) => event.target === dialogRef.current && dialogRef.current?.close()}
      >
        {infoKey && (
          <div className="info-body">
            <div className="info-head">
              <h2 id="info-title">{info[infoKey].title}</h2>
              <button type="button" className="text-link" onClick={() => dialogRef.current?.close()}>
                Close
              </button>
            </div>
            {info[infoKey].body}
          </div>
        )}
      </dialog>

      <CheckoutModal
        lines={checkoutLines}
        onClose={() => setCheckoutLines(null)}
        onPaid={() => {
          if (checkoutFromBag) setBag([]);
          setCheckoutLines(null);
        }}
        formatPrice={(value) => money.format(value)}
      />

      <OutfitBuilder
        open={lookOpen}
        items={detailItems}
        initialId={lookStart}
        onClose={() => setLookOpen(false)}
        onAddLook={addLook}
        onBuyLook={buyLook}
        formatPrice={(value) => money.format(value)}
      />

      <ProductModal
        items={detailItems}
        index={viewIndex}
        onClose={() => setViewIndex(null)}
        onNavigate={setViewIndex}
        onAdd={(item, size) => addToBag(item.name, size)}
        onBuyNow={(item, size) => buyNow(item.name, size)}
        onSizeGuide={() => openInfo('size')}
        onTryOn={(item) => openLook(item.id)}
        formatPrice={(value) => money.format(value)}
      />
    </>
  );
}
