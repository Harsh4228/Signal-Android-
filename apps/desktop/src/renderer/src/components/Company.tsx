import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Building2, ImagePlus, LifeBuoy, Plus, Trash2, X } from 'lucide-react';
import { MAX_COMPANY_ITEMS, MAX_COMPANY_ITEM_TEXT, MAX_COMPANY_ITEM_TITLE, MAX_COMPANY_NAME, type ChatMessage, type CompanyItem } from '@meetme/core';
import { client, useClient } from '../messenger';
import { Logo, errorText } from './ui';
import { MessageText } from './MessageText';
import { HelpDeskModal } from './AdminRights';
import { shrinkPhoto } from './AdminPanel';

type Toast = (m: string) => void;

/** The company logo (or the CellMate shield when there is none). */
export function CompanyLogo({ large }: { large?: boolean }) {
  const c = useClient();
  if (!c.companyLogo) return <Logo large={large} />;
  return <img className={`company-logo ${large ? 'lg' : ''}`} src={c.companyLogo} alt="" draggable={false} />;
}

/** Top of the chat list: the company's logo and name; click for everything the admins wrote about it. */
export function CompanyBadge({ onToast }: { onToast: Toast }) {
  const c = useClient();
  const [open, setOpen] = useState(false);
  const name = c.companyProfile?.name || c.company?.name || 'CellMate';
  return (
    <>
      <button className="company-badge" onClick={() => setOpen(true)} title={`About ${name}`}>
        <CompanyLogo />
        <span className="name">{name}</span>
      </button>
      {open && <CompanyInfo onClose={() => setOpen(false)} onToast={onToast} />}
    </>
  );
}

/** Everyone: the company's name, logo, the admins' information sections and the help desk. */
export function CompanyInfo({ onClose, onToast }: { onClose: () => void; onToast: Toast }) {
  const c = useClient();
  const p = c.companyProfile;
  const [help, setHelp] = useState(false);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal company-info" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">About the company</div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="company-hero">
          <CompanyLogo large />
          <div>
            <div className="name big">{p?.name || c.company?.name || 'CellMate'}</div>
            {c.company && <div className="muted small">Company code: {c.company.code}</div>}
          </div>
        </div>
        {p?.items.length ? (
          p.items.map((it) => (
            <section key={it.id} className="company-item">
              <div className="section-title">{it.title}</div>
              <div className="company-text">
                <MessageText m={{ text: it.text } as ChatMessage} />
              </div>
            </section>
          ))
        ) : (
          <p className="muted small">{c.isAdmin ? 'Add your office address, hours, rules or links under Admin > Company.' : 'Your admin has not added company information yet.'}</p>
        )}
        <button className="block" onClick={() => setHelp(true)} disabled={c.status !== 'online'}>
          <LifeBuoy size={16} /> Help desk: whom to contact
        </button>
        {help && <HelpDeskModal onClose={() => setHelp(false)} onToast={onToast} />}
      </div>
    </div>
  );
}

/** Admin: the company name, logo and information sections everyone sees at the top of the app. */
export function CompanyTab({ onToast }: { onToast: Toast }) {
  const c = useClient();
  const [name, setName] = useState(c.companyProfile?.name ?? c.company?.name ?? '');
  const [items, setItems] = useState<(Omit<CompanyItem, 'id'> & { id?: string })[]>(c.companyProfile?.items ?? []);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (c.companyProfile) {
      setName(c.companyProfile.name);
      setItems(c.companyProfile.items);
    }
  }, [c.companyProfile?.name, c.companyProfile?.items.length]);

  const set = (i: number, patch: Partial<CompanyItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setItems(next);
  };

  async function save() {
    setBusy(true);
    try {
      await client.setCompanyProfile({ ...(c.company ? { name } : {}), items: items.map((x) => ({ id: x.id ?? '', title: x.title, text: x.text })) });
      onToast('Company profile saved: everyone sees it now');
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function logo(f: File | undefined) {
    if (!f) return;
    try {
      await client.setCompanyLogo({ mime: 'image/jpeg', data: await shrinkPhoto(f) });
      onToast('Logo saved');
    } catch (e) {
      onToast(errorText(e));
    }
  }

  return (
    <div className="stack company-tab">
      <p className="muted small" style={{ margin: 0 }}>
        Everyone sees the logo and name at the top of their chat list. Clicking it shows the sections below and the help desk.
      </p>
      <div className="row" style={{ gap: 16, alignItems: 'center' }}>
        <label className="logo-pick" title="Upload a logo">
          {c.companyLogo ? <img src={c.companyLogo} alt="" draggable={false} /> : <ImagePlus size={24} />}
          <input type="file" accept="image/*" hidden onChange={(e) => void logo(e.target.files?.[0])} />
        </label>
        <div className="grow stack" style={{ gap: 6 }}>
          <label className="field-label">
            Company name
            <input value={name} maxLength={MAX_COMPANY_NAME} onChange={(e) => setName(e.target.value)} disabled={!c.company} />
          </label>
          {c.companyLogo && (
            <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => void client.setCompanyLogo(null).catch((e) => onToast(errorText(e)))}>
              Remove logo
            </button>
          )}
        </div>
      </div>

      <div className="section-head">
        <div className="section-title">Information sections</div>
        <button disabled={items.length >= MAX_COMPANY_ITEMS} onClick={() => setItems([...items, { title: '', text: '' }])}>
          <Plus size={15} /> Add section
        </button>
      </div>
      {!items.length && <p className="muted small">For example: Office address, Working hours, Leave policy, Wi-Fi, Useful links.</p>}
      {items.map((it, i) => (
        <div key={it.id ?? `new${i}`} className="card company-edit">
          <div className="row" style={{ gap: 6 }}>
            <Building2 size={16} className="muted" />
            <input
              className="grow"
              value={it.title}
              maxLength={MAX_COMPANY_ITEM_TITLE}
              placeholder="Title, e.g. Office address"
              onChange={(e) => set(i, { title: e.target.value })}
            />
            <button className="icon" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp size={15} />
            </button>
            <button className="icon" title="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown size={15} />
            </button>
            <button className="icon danger-text" title="Remove" onClick={() => setItems(items.filter((_, j) => j !== i))}>
              <Trash2 size={15} />
            </button>
          </div>
          <textarea
            rows={3}
            value={it.text}
            maxLength={MAX_COMPANY_ITEM_TEXT}
            placeholder="Text, phone numbers or links (they become tappable)"
            onChange={(e) => set(i, { text: e.target.value })}
          />
        </div>
      ))}
      <div className="row-end">
        <button className="primary" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>
  );
}
