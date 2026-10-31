import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Building2, FileText, Headset, ImagePlus, Loader2, Paperclip, Plus, Trash2, X } from 'lucide-react';
import { MAX_COMPANY_ITEMS, MAX_COMPANY_ITEM_TEXT, MAX_COMPANY_ITEM_TITLE, MAX_COMPANY_NAME, type CompanyFile, type CompanyItem } from '@meetme/core';
import { client, useClient } from '../messenger';
import { Logo, RichText, errorText, fileSize } from './ui';
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
              {!!it.text && (
                <div className="company-text">
                  <RichText text={it.text} />
                </div>
              )}
              {it.file && <FileButton file={it.file} onToast={onToast} />}
            </section>
          ))
        ) : (
          <p className="muted small">{c.isAdmin ? 'Add your office address, hours, rules or links under Admin > Company.' : 'Your admin has not added company information yet.'}</p>
        )}
        <button className="block" onClick={() => setHelp(true)} disabled={c.status !== 'online'}>
          <Headset size={16} /> Help desk: whom to contact
        </button>
        {help && <HelpDeskModal onClose={() => setHelp(false)} onToast={onToast} />}
      </div>
    </div>
  );
}

/** A file in the company information: click to open it (PDFs and pictures open in the browser). */
export function FileButton({ file, onToast }: { file: CompanyFile; onToast: Toast }) {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    try {
      const f = await client.companyFile(file.id);
      const url = URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.mime }));
      const a = document.createElement('a');
      a.href = url;
      // PDFs and pictures open to read; other documents are saved.
      if (/^(application\/pdf|image\/)/.test(f.mime) && !window.meetme.openLink) a.target = '_blank';
      else a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className="file-chip" onClick={() => void open()} disabled={busy} title={`Open ${file.name}`}>
      {busy ? <Loader2 size={16} className="spin" /> : <FileText size={16} />}
      <span className="grow">{file.name}</span>
      <span className="muted small">{fileSize(file.size)}</span>
    </button>
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
      await client.setCompanyProfile({
        ...(c.company ? { name } : {}),
        items: items.map((x) => ({ id: x.id ?? '', title: x.title, text: x.text, ...(x.file ? { file: x.file } : {}) })),
      });
      onToast('Company profile saved: everyone sees it now');
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const [uploading, setUploading] = useState<number | null>(null);
  async function attach(i: number, f: File | undefined) {
    if (!f) return;
    setUploading(i);
    try {
      const file = await client.uploadCompanyFile({ name: f.name, mime: f.type, data: new Uint8Array(await f.arrayBuffer()) });
      set(i, { file });
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setUploading(null);
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
            placeholder="Text. Phone numbers, emails and website links become clickable."
            onChange={(e) => set(i, { text: e.target.value })}
          />
          {it.file ? (
            <div className="row" style={{ gap: 6 }}>
              <FileButton file={it.file} onToast={onToast} />
              <button className="icon danger-text" title="Remove the file" onClick={() => set(i, { file: undefined })}>
                <X size={15} />
              </button>
            </div>
          ) : (
            <label className="link-btn attach-link">
              {uploading === i ? <Loader2 size={14} className="spin" /> : <Paperclip size={14} />} Attach a file (PDF, picture, document, up to 8 MB)
              <input
                type="file"
                hidden
                accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                onChange={(e) => void attach(i, e.target.files?.[0])}
              />
            </label>
          )}
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
