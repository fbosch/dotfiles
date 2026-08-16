import type { Meta, StoryObj } from '@storybook/react-vite';
import tokens from '../../tokens.json';

type Swatch = {
  name: string;
  value: string;
  usage: string;
  sample?: string;
  sampleColor?: string;
};

type SemanticRamp = {
  name: string;
  usage: string;
  swatches: Array<Required<Pick<Swatch, 'name' | 'value' | 'sampleColor'>>>;
};

type AnsiPair = {
  name: string;
  standard: string;
  bright: string;
};

const accentSwatches: Swatch[] = [
  {
    name: 'Primary',
    value: tokens.colors.accent.primary.value,
    usage: 'Primary controls and meter fill',
    sample: 'Primary action',
    sampleColor: tokens.colors.accent.text.value,
  },
  {
    name: 'Hover',
    value: tokens.colors.accent.hover.value,
    usage: 'Focus borders and emphasized icons',
    sample: 'Hover state',
    sampleColor: tokens.colors.accent.text.value,
  },
  {
    name: 'Active',
    value: tokens.colors.accent.active.value,
    usage: 'Pressed and selected surfaces',
    sample: 'Selected state',
    sampleColor: tokens.colors.accent['active-text'].value,
  },
];

const backgroundSwatches: Swatch[] = [
  {
    name: 'Primary',
    value: tokens.colors.background.primary.value,
    usage: 'Base canvas',
  },
  {
    name: 'Secondary',
    value: tokens.colors.background.secondary.value,
    usage: 'Panels and elevated surfaces',
  },
  {
    name: 'Tertiary',
    value: tokens.colors.background.tertiary.value,
    usage: 'Controls and nested surfaces',
  },
];

const foregroundSwatches: Swatch[] = [
  {
    name: 'Primary',
    value: tokens.colors.foreground.primary.value,
    usage: 'Primary text',
  },
  {
    name: 'Secondary',
    value: tokens.colors.foreground.secondary.value,
    usage: 'Supporting text',
  },
  {
    name: 'Tertiary',
    value: tokens.colors.foreground.tertiary.value,
    usage: 'Muted text',
  },
];

const ansiPairs: AnsiPair[] = [
  {
    name: 'Black',
    standard: tokens.colors.ansi.black.value,
    bright: tokens.colors.ansi['bright-black'].value,
  },
  {
    name: 'Red',
    standard: tokens.colors.ansi.red.value,
    bright: tokens.colors.ansi['bright-red'].value,
  },
  {
    name: 'Green',
    standard: tokens.colors.ansi.green.value,
    bright: tokens.colors.ansi['bright-green'].value,
  },
  {
    name: 'Yellow',
    standard: tokens.colors.ansi.yellow.value,
    bright: tokens.colors.ansi['bright-yellow'].value,
  },
  {
    name: 'Magenta',
    standard: tokens.colors.ansi.magenta.value,
    bright: tokens.colors.ansi['bright-magenta'].value,
  },
  {
    name: 'Cyan',
    standard: tokens.colors.ansi.cyan.value,
    bright: tokens.colors.ansi['bright-cyan'].value,
  },
  {
    name: 'White',
    standard: tokens.colors.ansi.white.value,
    bright: tokens.colors.ansi['bright-white'].value,
  },
];

const semanticRamps: SemanticRamp[] = [
  {
    name: 'Success',
    usage: 'Positive actions and completed states',
    swatches: [
      {
        name: 'Base',
        value: tokens.colors.state.success.value,
        sampleColor: tokens.colors.state['success-text'].value,
      },
      {
        name: 'Hover',
        value: tokens.colors.state['success-hover'].value,
        sampleColor: tokens.colors.state['success-text'].value,
      },
      {
        name: 'Active',
        value: tokens.colors.state['success-active'].value,
        sampleColor: tokens.colors.state['success-active-text'].value,
      },
    ],
  },
  {
    name: 'Warning',
    usage: 'Caution and confirmation-needed states',
    swatches: [
      {
        name: 'Base',
        value: tokens.colors.state.warning.value,
        sampleColor: tokens.colors.state['warning-text'].value,
      },
      {
        name: 'Hover',
        value: tokens.colors.state['warning-hover'].value,
        sampleColor: tokens.colors.state['warning-text'].value,
      },
      {
        name: 'Active',
        value: tokens.colors.state['warning-active'].value,
        sampleColor: tokens.colors.state['warning-active-text'].value,
      },
    ],
  },
  {
    name: 'Error',
    usage: 'Destructive actions and muted audio',
    swatches: [
      {
        name: 'Base',
        value: tokens.colors.state.error.value,
        sampleColor: tokens.colors.state['error-text'].value,
      },
      {
        name: 'Hover',
        value: tokens.colors.state['error-hover'].value,
        sampleColor: tokens.colors.state['error-text'].value,
      },
      {
        name: 'Active',
        value: tokens.colors.state['error-active'].value,
        sampleColor: tokens.colors.state['error-active-text'].value,
      },
    ],
  },
  {
    name: 'Info',
    usage: 'Informational and non-destructive actions',
    swatches: [
      {
        name: 'Base',
        value: tokens.colors.state.info.value,
        sampleColor: tokens.colors.state['info-text'].value,
      },
      {
        name: 'Hover',
        value: tokens.colors.state['info-hover'].value,
        sampleColor: tokens.colors.state['info-text'].value,
      },
      {
        name: 'Active',
        value: tokens.colors.state['info-active'].value,
        sampleColor: tokens.colors.state['info-active-text'].value,
      },
    ],
  },
  {
    name: 'Purple',
    usage: 'Secondary actions and optional emphasis',
    swatches: [
      {
        name: 'Base',
        value: tokens.colors.state.purple.value,
        sampleColor: tokens.colors.state['purple-text'].value,
      },
      {
        name: 'Hover',
        value: tokens.colors.state['purple-hover'].value,
        sampleColor: tokens.colors.state['purple-text'].value,
      },
      {
        name: 'Active',
        value: tokens.colors.state['purple-active'].value,
        sampleColor: tokens.colors.state['purple-active-text'].value,
      },
    ],
  },
];

function Swatch({ name, value, usage, sample, sampleColor }: Swatch) {
  return (
    <article className="overflow-hidden rounded-xl border border-white/10 bg-background-secondary shadow-sm">
      <div
        className="flex h-24 items-end p-3"
        style={{ backgroundColor: value, color: sampleColor }}
      >
        {sample ? <span className="text-sm font-semibold">{sample}</span> : null}
      </div>
      <div className="space-y-1 p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground-primary">{name}</h3>
          <code className="font-mono text-xs text-foreground-secondary">{value}</code>
        </div>
        <p className="text-xs text-foreground-tertiary">{usage}</p>
      </div>
    </article>
  );
}

function PaletteSection({
  title,
  description,
  swatches,
}: {
  title: string;
  description: string;
  swatches: Swatch[];
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground-primary">{title}</h2>
        <p className="text-sm text-foreground-secondary">{description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {swatches.map((swatch) => (
          <Swatch key={swatch.name} {...swatch} />
        ))}
      </div>
    </section>
  );
}

function SemanticRampCard({ name, usage, swatches }: SemanticRamp) {
  return (
    <article className="space-y-4 rounded-xl border border-white/10 bg-background-secondary p-4 shadow-sm">
      <div>
        <h3 className="text-base font-semibold text-foreground-primary">{name}</h3>
        <p className="text-sm text-foreground-secondary">{usage}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {swatches.map((swatch) => (
          <div key={swatch.name} className="space-y-2">
            <div
              className="flex h-16 items-end rounded-lg p-2"
              style={{ backgroundColor: swatch.value, color: swatch.sampleColor }}
            >
              <span className="text-xs font-semibold">Aa</span>
            </div>
            <div>
              <p className="text-xs font-medium text-foreground-primary">{swatch.name}</p>
              <code className="font-mono text-[11px] text-foreground-tertiary">{swatch.value}</code>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function AnsiPalette() {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground-primary">ANSI reference palette</h2>
        <p className="text-sm text-foreground-secondary">
          The complete Zenwritten terminal palette. Yellow is intentionally a warm terracotta rather
          than a pure yellow. These colors support data and domain-specific distinction, not routine
          interaction states.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ansiPairs.map((pair) => (
          <article
            key={pair.name}
            className="space-y-3 rounded-xl border border-white/10 bg-background-secondary p-3 shadow-sm"
          >
            <h3 className="text-sm font-semibold text-foreground-primary">{pair.name}</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { name: 'ANSI', value: pair.standard },
                { name: 'Bright', value: pair.bright },
              ].map((swatch) => (
                <div key={swatch.name} className="space-y-2">
                  <div className="h-14 rounded-lg" style={{ backgroundColor: swatch.value }} />
                  <div>
                    <p className="text-xs font-medium text-foreground-primary">{swatch.name}</p>
                    <code className="font-mono text-[11px] text-foreground-tertiary">
                      {swatch.value}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

const meta = {
  title: 'Foundation/Color Palette',
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ZenwrittenDark: Story = {
  render: () => (
    <main className="min-h-screen space-y-12 bg-background-primary p-6 font-primary sm:p-10">
      <header className="max-w-2xl space-y-3">
        <p className="text-sm font-medium text-accent-hover">Foundation</p>
        <h1 className="text-3xl font-semibold text-foreground-primary">Zenwritten Dark palette</h1>
        <p className="text-sm leading-6 text-foreground-secondary">
          Grayscale layers define hierarchy. Blue communicates interaction. Semantic colors are
          reserved for state and retain distinct base, hover, and active values.
        </p>
      </header>
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground-primary">Foundation</h2>
          <p className="text-sm text-foreground-secondary">
            Neutral layers establish elevation and readable text before any color is introduced.
          </p>
        </div>
        <div className="grid gap-8 xl:grid-cols-2">
          <PaletteSection
            title="Surface layers"
            description="Canvas, panels, and nested controls."
            swatches={backgroundSwatches}
          />
          <PaletteSection
            title="Text hierarchy"
            description="Primary, supporting, and muted copy."
            swatches={foregroundSwatches}
          />
        </div>
      </section>
      <PaletteSection
        title="Interaction blue"
        description="One blue family carries default, hover, and selected interaction states."
        swatches={accentSwatches}
      />
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground-primary">Semantic state ramps</h2>
          <p className="text-sm text-foreground-secondary">
            Use semantic color only when it communicates meaning. Each swatch shows its validated
            foreground pairing.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {semanticRamps.map((ramp) => (
            <SemanticRampCard key={ramp.name} {...ramp} />
          ))}
        </div>
      </section>
      <AnsiPalette />
    </main>
  ),
};
