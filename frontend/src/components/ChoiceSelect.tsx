import React, { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

type Props = {
  value: string | number;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  title?: string;
  'aria-label'?: string;
};

/** Select-only combobox: focus stays on the trigger during keyboard navigation. */
export default function ChoiceSelect({ value, onValueChange, children, disabled, className = '', title, 'aria-label': label }: Props) {
  const options = Children.toArray(children).filter(isValidElement).map(child => {
    const props = (child as React.ReactElement<React.ComponentProps<'option'>>).props;
    return { value: String(props.value ?? ''), label: props.children, disabled: props.disabled };
  });
  const selected = options.findIndex(option => option.value === String(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 280 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const id = useId();
  const show = () => { setActive(Math.max(0, selected)); setOpen(true); };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const upward = below < 180 && above > below;
    const maxHeight = Math.min(280, Math.max(64, upward ? above : below));
    const height = Math.min(maxHeight, menu.current?.scrollHeight ?? options.length * 50 + 16);
    const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: upward ? rect.top - height - 8 : rect.bottom + 8, width, maxHeight });
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = (event: Event) => { if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, open, id]);
  const move = (delta: number) => {
    for (let step = 1; step <= options.length; step++) {
      const next = (active + delta * step + options.length) % options.length;
      if (!options[next].disabled) { setActive(next); break; }
    }
  };
  return <span className={`ui-choice ${className}`}>
    <button ref={trigger} type="button" role="combobox" aria-label={label || title} title={title} aria-expanded={open}
      aria-controls={open ? id : undefined} aria-haspopup="listbox" aria-activedescendant={open ? `${id}-${active}` : undefined}
      disabled={disabled} className="ui-choice-trigger" onClick={() => open ? setOpen(false) : show()}
      onKeyDown={event => {
        if (event.key === 'Tab') { setOpen(false); return; }
        if (event.key === 'Escape') { if (open) { event.stopPropagation(); event.preventDefault(); setOpen(false); } return; }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
          event.preventDefault();
          if (!open) { show(); return; }
          if (event.key === 'Enter' || event.key === ' ') choose(active);
          else if (event.key === 'Home') setActive(Math.max(0, options.findIndex(option => !option.disabled)));
          else if (event.key === 'End') setActive(options.reduce((last, option, index) => option.disabled ? last : index, 0));
          else move(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          const now = Date.now();
          search.current = { text: (now - search.current.time < 700 ? search.current.text : '') + event.key.toLowerCase(), time: now };
          const index = options.findIndex(option => !option.disabled && Children.toArray(option.label).join('').toLowerCase().startsWith(search.current.text));
          if (!open) show();
          if (index >= 0) setActive(index);
        }
      }}><span>{options[selected]?.label ?? options[0]?.label}</span><ChevronDown size={18} aria-hidden="true" /></button>
    {open && !disabled && createPortal(<div className="learner-app ui-choice-overlay"><div ref={menu} id={id} role="listbox" aria-label={label || title} className="ui-choice-menu" style={position}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={index === selected} aria-disabled={option.disabled || undefined}
        data-active={index === active} onPointerMove={() => !option.disabled && setActive(index)} onPointerDown={event => { if (event.pointerType === 'mouse') event.preventDefault(); }} onClick={() => choose(index)}>
        <span>{option.label}</span>{index === selected && <Check size={17} aria-hidden="true" />}
      </div>)}
    </div></div>, document.body)}
  </span>;
}
