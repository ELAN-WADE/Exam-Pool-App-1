import React from 'react';

export type LanguageCode = 'EN' | 'YO' | 'HA' | 'IG';

interface LanguageSwitcherProps {
  currentLang: LanguageCode;
  onLanguageChange: (lang: LanguageCode) => void;
}

export function LanguageSwitcher({ currentLang, onLanguageChange }: LanguageSwitcherProps) {
  const languages: { code: LanguageCode; label: string }[] = [
    { code: 'EN', label: 'English' },
    { code: 'YO', label: 'Yorùbá' },
    { code: 'HA', label: 'Hausa' },
    { code: 'IG', label: 'Igbo' }
  ];

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <span style={{ fontSize: '0.85rem', color: '#666', fontWeight: 600 }}>Language:</span>
      <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: '4px', overflow: 'hidden' }}>
        {languages.map(lang => (
          <button
            key={lang.code}
            onClick={() => onLanguageChange(lang.code)}
            style={{
              padding: '0.25rem 0.5rem',
              border: 'none',
              background: currentLang === lang.code ? 'var(--color-primary)' : 'white',
              color: currentLang === lang.code ? 'white' : '#333',
              cursor: 'pointer',
              fontWeight: currentLang === lang.code ? 600 : 400,
              fontSize: '0.85rem',
              transition: 'all 0.2s'
            }}
          >
            {lang.code}
          </button>
        ))}
      </div>
    </div>
  );
}
