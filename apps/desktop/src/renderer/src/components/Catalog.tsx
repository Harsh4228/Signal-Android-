import { useEffect, useState } from 'react';
import { ImagePlus, Loader2, Pencil, Plus, Search, Send, ShoppingBag, Trash2, X } from 'lucide-react';
import {
  AVATAR_MIMES,
  MAX_AVATAR_BYTES,
  MAX_PRODUCT_DESC,
  MAX_PRODUCT_NAME,
  MAX_PRODUCT_PRICE,
  toBase64,
  type Product,
  type ProductInput,
} from '@meetme/core';
import { client, useClient } from '../messenger';
import { ChatAvatar, errorText } from './ui';

const card = (p: Product) => ({ id: p.id, owner: p.owner, name: p.name, price: p.price || undefined, description: p.description || undefined });

function ProductPhoto({ p, size = 'md' }: { p: Product; size?: 'md' | 'lg' }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    setUrl(null);
    client
      .productPhoto(p)
      .then((u) => !gone && setUrl(u))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [p.id, p.photo]);
  return (
    <div className={`product-photo ${size}`}>
      {url ? <img src={url} alt="" draggable={false} /> : <ShoppingBag size={size === 'lg' ? 36 : 26} />}
    </div>
  );
}

/**
 * A catalog, like WhatsApp Business. Mine (default): add, change, delete and share my products. Someone else's
 * (`owner`, opened from their profile or a product card): browse and share their products.
 * With `chat`, picking a product sends it there (from a chat's attach menu).
 */
export function CatalogPanel({
  chat,
  owner,
  onClose,
  onToast,
}: {
  chat?: string;
  owner?: string;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const c = useClient();
  const me = c.account?.username;
  const mine = !owner || owner === me;
  const [products, setProducts] = useState<Product[] | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [sharing, setSharing] = useState<Product | null>(null);

  const reload = () =>
    client
      .listProducts(mine ? undefined : owner)
      .then(setProducts)
      .catch((e) => {
        onToast(errorText(e));
        setProducts([]);
      });
  useEffect(() => void reload(), []);

  const shown = (products ?? []).filter((p) => !q.trim() || `${p.name} ${p.description}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function sendTo(key: string, p: Product) {
    try {
      await client.sendProduct(key, card(p));
      onToast(`Shared ${p.name} with ${c.chatTitle(key)}`);
      onClose();
    } catch (e) {
      onToast(errorText(e));
    }
  }

  async function remove(p: Product) {
    if (!confirm(`Delete ${p.name} from the catalog?`)) return;
    try {
      await client.deleteProduct(p.id);
      void reload();
    } catch (e) {
      onToast(errorText(e));
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide catalog" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <ShoppingBag size={18} />
            </span>
            {chat ? `Send a product to ${c.chatTitle(chat)}` : mine ? 'My catalog' : `${owner}'s catalog`}
          </div>
          <div className="row">
            {mine && !chat && (
              <button className="primary" onClick={() => setEditing('new')}>
                <Plus size={16} /> Add product
              </button>
            )}
            <button className="icon" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </header>
        {(products?.length ?? 0) > 6 && (
          <div className="search" style={{ marginBottom: 12 }}>
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" />
          </div>
        )}
        {products === null ? (
          <div className="notice-empty muted">
            <Loader2 size={24} className="spin" />
          </div>
        ) : !shown.length ? (
          <div className="notice-empty muted">
            <ShoppingBag size={28} color="var(--faint)" />
            <div>{q ? 'No products match' : mine ? 'Your catalog is empty' : `${owner} has no products yet`}</div>
            {mine && !q && !chat && <div className="small">Click "Add product" to start your catalog.</div>}
            {mine && !q && chat && <div className="small">Add products first: ⋮ → My catalog.</div>}
          </div>
        ) : (
          <div className="product-grid">
            {shown.map((p) => (
              <div key={p.id} className="product">
                <ProductPhoto p={p} />
                <div className="product-name">{p.name}</div>
                {p.price && <div className="product-price">{p.price}</div>}
                {p.description && <div className="muted small product-desc">{p.description}</div>}
                <div className="row product-actions">
                  <button className="primary" onClick={() => (chat ? void sendTo(chat, p) : setSharing(p))}>
                    <Send size={14} /> {chat ? 'Send' : 'Share'}
                  </button>
                  {mine && !chat && (
                    <>
                      <button className="icon" title="Edit" onClick={() => setEditing(p)}>
                        <Pencil size={15} />
                      </button>
                      <button className="icon danger" title="Delete" onClick={() => void remove(p)}>
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>
          {mine
            ? 'Colleagues can open your catalog from your profile, like WhatsApp Business. Only you can change it.'
            : `Only ${owner} can change this catalog.`}{' '}
          Products shared into a chat are end-to-end encrypted; the catalog itself is stored on the server.
        </p>
      </div>
      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
          onError={onToast}
        />
      )}
      {sharing && (
        <div className="modal-bg" onClick={() => setSharing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <div className="title">Share {sharing.name} to…</div>
              <button className="icon" onClick={() => setSharing(null)} title="Close">
                <X size={18} />
              </button>
            </header>
            <ul className="emp-list forward-list">
              {c
                .chatKeys()
                .filter((k) => c.canSendTo(k))
                .map((k) => (
                  <li key={k} className="clickable" onClick={() => void sendTo(k, sharing)}>
                    <ChatAvatar chatKey={k} />
                    <div className="grow name">{c.chatTitle(k)}</div>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductForm({
  product,
  onClose,
  onSaved,
  onError,
}: {
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [price, setPrice] = useState(product?.price ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  /** undefined = keep, null = remove, value = new photo */
  const [photo, setPhoto] = useState<{ mime: string; data: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function pick(f: File | undefined) {
    if (!f) return;
    if (!(AVATAR_MIMES as readonly string[]).includes(f.type)) return onError('Photo must be JPEG, PNG or WebP');
    if (f.size > MAX_AVATAR_BYTES) return onError('Photo too large (max 2 MB)');
    setPhoto({ mime: f.type, data: toBase64(new Uint8Array(await f.arrayBuffer())) });
  }

  async function save() {
    setBusy(true);
    try {
      const input: ProductInput = { name, price, description, ...(photo !== undefined ? { photo } : {}) };
      if (product) await client.updateProduct(product.id, input);
      else await client.createProduct(input);
      onSaved();
    } catch (e) {
      onError(errorText(e));
      setBusy(false);
    }
  }

  const hasPhoto = photo ? true : photo === null ? false : !!product?.photo;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <ShoppingBag size={18} />
            </span>
            {product ? 'Edit product' : 'Add product'}
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="stack">
          <div className="row">
            {photo ? (
              <div className="product-photo md">
                <img src={`data:${photo.mime};base64,${photo.data}`} alt="" />
              </div>
            ) : hasPhoto && product ? (
              <ProductPhoto p={product} />
            ) : (
              <div className="product-photo md">
                <ShoppingBag size={26} />
              </div>
            )}
            <label className="file-btn">
              <ImagePlus size={16} />
              <span>{hasPhoto ? 'Change photo' : 'Add photo'}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void pick(e.target.files?.[0])} />
            </label>
            {hasPhoto && (
              <button className="icon" title="Remove photo" onClick={() => setPhoto(null)}>
                <Trash2 size={16} />
              </button>
            )}
          </div>
          <input value={name} maxLength={MAX_PRODUCT_NAME} onChange={(e) => setName(e.target.value)} placeholder="Product name" autoFocus />
          <input value={price} maxLength={MAX_PRODUCT_PRICE} onChange={(e) => setPrice(e.target.value)} placeholder="Price (optional), e.g. ₹4,999" />
          <textarea
            rows={4}
            value={description}
            maxLength={MAX_PRODUCT_DESC}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
          />
        </div>
        <div className="row-end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !name.trim()} onClick={save}>
            {product ? 'Save' : 'Add to catalog'}
          </button>
        </div>
      </div>
    </div>
  );
}
