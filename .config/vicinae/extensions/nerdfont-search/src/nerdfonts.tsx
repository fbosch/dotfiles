import React from 'react';
import { List, ActionPanel, Action, Icon } from '@vicinae/api';

import glyphnames from '../assets/glyphnames.json';

type GlyphRecord = Record<string, { char: string; code: string }>;

type IconEntry = {
	id: string;
	pack: string;
	packLabel: string;
	displayName: string;
	char: string;
	code: string;
	hexCode: string;
	htmlEntity: string;
	nerdFontId: string;
	keywords: string[];
	markdown: string;
};

const PACK_LABELS: Record<string, string> = {
	cod: 'VS Code Codicons',
	custom: 'Custom Icons',
	dev: 'Devicons',
	extra: 'Nerd Font Extras',
	fa: 'Font Awesome',
	fae: 'Font Awesome Extension',
	iec: 'IEC Power',
	indent: 'Indent Icons',
	indentation: 'Indentation Icons',
	linux: 'Linux Logos',
	md: 'Material Design',
	oct: 'GitHub Octicons',
	pl: 'Powerline',
	ple: 'Powerline Extra',
	pom: 'Pomicons',
	seti: 'Seti UI',
	weather: 'Weather Icons',
};

const ACRONYMS = new Set([
	'api',
	'aws',
	'css',
	'cpu',
	'db',
	'dev',
	'doc',
	'gpu',
	'html',
	'id',
	'ip',
	'js',
	'nfc',
	'npm',
	'pdf',
	'sql',
	'ui',
	'url',
	'usb',
	'vm',
	'vpn',
	'xml',
]);

const TOKEN_SYNONYMS: Record<string, string[]> = {
	account: ['user', 'profile', 'person', 'avatar'],
	add: ['plus', 'new'],
	alert: ['warning', 'caution', 'triangle'],
	anchor: ['ship', 'boat'],
	app: ['application', 'program'],
	arrow: ['direction', 'chevron', 'pointer'],
	audio: ['sound', 'speaker', 'volume'],
	back: ['previous', 'left'],
	bell: ['notification', 'alert'],
	bird: ['animal'],
	bolt: ['lightning', 'electric', 'flash'],
	book: ['read', 'library', 'manual'],
	box: ['container', 'package'],
	bug: ['issue', 'defect', 'problem'],
	bulb: ['idea', 'light'],
	camera: ['photo', 'picture'],
	cancel: ['close', 'stop', 'abort'],
	car: ['vehicle', 'auto'],
	cart: ['shopping', 'basket'],
	certificate: ['badge', 'award'],
	chat: ['message', 'speech', 'bubble'],
	check: ['tick', 'confirm', 'done', 'ok', 'success'],
	circle: ['round', 'button'],
	clipboard: ['copy', 'paste'],
	close: ['cross', 'cancel', 'x'],
	cloud: ['upload', 'download', 'storage'],
	code: ['developer', 'program'],
	cog: ['settings', 'gear', 'preferences'],
	column: ['layout'],
	comment: ['message', 'chat'],
	compass: ['navigation', 'direction'],
	copy: ['duplicate', 'clone'],
	cpu: ['processor', 'chip'],
	cross: ['close', 'cancel', 'multiply'],
	delete: ['remove', 'trash', 'bin'],
	desktop: ['computer', 'monitor'],
	document: ['file', 'paper'],
	download: ['save', 'arrow down'],
	edit: ['pencil', 'write'],
	email: ['mail', 'envelope'],
	error: ['issue', 'problem', 'warning'],
	exit: ['logout', 'leave'],
	file: ['document', 'paper'],
	filter: ['funnel', 'narrow'],
	flag: ['marker', 'milestone'],
	folder: ['directory'],
	forward: ['next', 'right'],
	gift: ['present'],
	globe: ['world', 'earth'],
	graph: ['chart'],
	grid: ['layout'],
	heart: ['like', 'love', 'favorite'],
	help: ['question', 'support'],
	home: ['house'],
	image: ['picture', 'photo'],
	info: ['information', 'details'],
	light: ['sun', 'bright'],
	link: ['chain', 'url'],
	list: ['menu', 'items', 'bullet'],
	lock: ['secure', 'security'],
	login: ['sign in'],
	logout: ['sign out', 'exit'],
	magnifier: ['search', 'find'],
	menu: ['hamburger', 'navigation'],
	message: ['chat', 'speech'],
	microphone: ['audio', 'voice', 'record'],
	minus: ['remove', 'dash'],
	moon: ['night', 'dark'],
	music: ['audio', 'note', 'song'],
	mute: ['silent', 'speaker'],
	notification: ['alert', 'bell'],
	open: ['unlock'],
	palette: ['color', 'paint'],
	paperclip: ['attachment'],
	pause: ['stop'],
	pay: ['money', 'currency'],
	pen: ['edit', 'write', 'pencil'],
	pencil: ['edit', 'draw', 'write'],
	people: ['users', 'group', 'team'],
	phone: ['call', 'telephone'],
	picture: ['photo', 'image'],
	play: ['start', 'triangle'],
	plug: ['power', 'electric'],
	plus: ['add', 'new'],
	power: ['shutdown', 'off'],
	print: ['printer'],
	question: ['help', 'support'],
	redo: ['forward', 'arrow'],
	refresh: ['reload', 'sync', 'update'],
	remove: ['delete', 'trash'],
	repeat: ['loop'],
	reply: ['answer'],
	rocket: ['ship', 'launch'],
	save: ['disk'],
	search: ['find', 'magnifying', 'magnifier'],
	settings: ['cog', 'gear', 'preferences'],
	share: ['export', 'send'],
	shield: ['security', 'protection'],
	skip: ['jump'],
	sort: ['order'],
	speaker: ['audio', 'sound', 'volume'],
	star: ['favorite', 'bookmark', 'rating'],
	status: ['indicator'],
	stop: ['square', 'halt'],
	sun: ['day', 'light'],
	sync: ['refresh', 'reload', 'update'],
	tag: ['label', 'badge'],
	target: ['aim', 'bullseye'],
	terminal: ['cli', 'command', 'prompt'],
	text: ['font', 'type'],
	time: ['clock', 'schedule'],
	timer: ['clock', 'alarm'],
	toggle: ['switch'],
	trash: ['delete', 'remove', 'bin'],
	unlock: ['access', 'open'],
	update: ['refresh', 'sync'],
	upload: ['arrow up'],
	user: ['person', 'account', 'profile'],
	video: ['movie', 'camera'],
	volume: ['speaker', 'sound', 'audio'],
	warning: ['alert', 'triangle'],
	wifi: ['network', 'signal'],
	window: ['app', 'application'],
	write: ['edit', 'pencil'],
	x: ['close', 'cancel', 'cross'],
	dog: ['puppy', 'animal', 'pet'],
	cat: ['kitten', 'animal', 'pet'],
	left: ['previous', 'west', 'back'],
	right: ['next', 'east', 'forward'],
	up: ['north', 'increase', 'raise'],
	down: ['south', 'decrease', 'lower'],
	times: ['close', 'cross', 'multiply'],
	lightning: ['bolt', 'electric'],
};

const glyphnamesData = glyphnames as unknown as GlyphRecord & { METADATA?: unknown };
const { METADATA: _metadata, ...rawGlyphs } = glyphnamesData;

const ICONS: IconEntry[] = Object.entries(rawGlyphs)
	.filter(([id]) => id !== 'METADATA')
	.map(([id, glyph]) => createIconEntry(id, glyph))
	.sort((a, b) => a.displayName.localeCompare(b.displayName));

const PACK_OPTIONS = ICONS.reduce<Record<string, string>>((acc, icon) => {
	if (!acc[icon.pack]) {
		acc[icon.pack] = icon.packLabel;
	}
	return acc;
}, {});

const PACK_FILTER_OPTIONS = Object.entries(PACK_OPTIONS)
	.map(([value, label]) => ({ value, label }))
	.sort((a, b) => a.label.localeCompare(b.label));

export default function NerdFontSearch() {
	const [selectedPack, setSelectedPack] = React.useState<string>('all');

	const filteredIcons = React.useMemo(() => {
		if (selectedPack === 'all') {
			return ICONS;
		}
		return ICONS.filter(icon => icon.pack === selectedPack);
	}, [selectedPack]);

	return (
		<List
			filtering
			searchBarPlaceholder='Search Nerd Font icons (e.g. "speaker", "dog", "cross")'
			searchBarAccessory={
				<List.Dropdown
					tooltip='Filter by icon pack'
					storeValue
					onChange={setSelectedPack}
					value={selectedPack}
				>
					<List.Dropdown.Item title='All icon packs' value='all' />
					{PACK_FILTER_OPTIONS.map(option => (
						<List.Dropdown.Item key={option.value} title={option.label} value={option.value} />
					))}
				</List.Dropdown>
			}
		>
			{filteredIcons.length === 0 ? (
				<List.EmptyView
					title='No icons found'
					description='Try a different search term or pick another icon pack.'
					icon={Icon.MagnifyingGlass}
				/>
			) : (
				<List.Section
					title={selectedPack === 'all' ? 'All icon packs' : PACK_LABELS[selectedPack] ?? selectedPack.toUpperCase()}
					subtitle={`${filteredIcons.length.toLocaleString()} icons`}
				>
					{filteredIcons.map(icon => (
						<List.Item
							key={icon.id}
							id={icon.id}
							title={icon.displayName}
							subtitle={icon.nerdFontId}
							icon={icon.char}
							keywords={icon.keywords}
							accessories={[
								{ text: icon.char, tooltip: 'Glyph' },
								{ text: icon.hexCode, tooltip: 'Unicode codepoint' },
							]}
							detail={
								<List.Item.Detail
									markdown={icon.markdown}
									metadata={
										<List.Item.Detail.Metadata>
											<List.Item.Detail.Metadata.Label title='Icon pack' text={icon.packLabel} />
											<List.Item.Detail.Metadata.Label title='Identifier' text={icon.id} />
											<List.Item.Detail.Metadata.Label title='Nerd Font name' text={icon.nerdFontId} />
											<List.Item.Detail.Metadata.Label title='Unicode' text={icon.hexCode} />
											<List.Item.Detail.Metadata.Label title='HTML entity' text={icon.htmlEntity} />
											<List.Item.Detail.Metadata.Label title='Glyph' text={icon.char} />
										</List.Item.Detail.Metadata>
									}
								/>
							}
							actions={<IconActions icon={icon} />}
						/>
					))}
				</List.Section>
			)}
		</List>
	);
}

function IconActions({ icon }: { icon: IconEntry }) {
	return (
		<ActionPanel>
			<ActionPanel.Section>
				<Action.CopyToClipboard
					title='Copy glyph'
					content={icon.char}
					icon={Icon.CopyClipboard}
				/>
				<Action.CopyToClipboard
					title='Copy Nerd Font name'
					content={icon.nerdFontId}
					icon={Icon.Hashtag}
				/>
				<Action.CopyToClipboard
					title='Copy identifier'
					content={icon.id}
					icon={Icon.Document}
				/>
				<Action.CopyToClipboard
					title='Copy Unicode codepoint'
					content={icon.hexCode}
					icon={Icon.Terminal}
				/>
				<Action.CopyToClipboard
					title='Copy HTML entity'
					content={icon.htmlEntity}
					icon={Icon.Globe}
				/>
			</ActionPanel.Section>
		</ActionPanel>
	);
}

function createIconEntry(id: string, glyph: { char: string; code: string }): IconEntry {
	const [pack, ...rest] = id.split('-');
	const rawName = rest.join('-');
	const packLabel = PACK_LABELS[pack] ?? pack.toUpperCase();
	const words = splitNameIntoWords(rawName);
	const displayName = words.length > 0 ? words.map(toTitleCase).join(' ') : toTitleCase(pack);

	const codeUpper = glyph.code.toUpperCase();
	const nerdFontId = `nf-${id.replace(/_/g, '-')}`;
	const htmlEntity = `&#x${glyph.code};`;
	const keywordSet = new Set<string>();

	keywordSet.add(id.toLowerCase());
	keywordSet.add(id.replace(/_/g, ' ').toLowerCase());
	keywordSet.add(nerdFontId.toLowerCase());
	keywordSet.add(nerdFontId.replace(/-/g, ' '));
	keywordSet.add(pack.toLowerCase());
	keywordSet.add(packLabel.toLowerCase());
	packLabel.toLowerCase().split(/\s+/).forEach(token => {
		if (token) {
			keywordSet.add(token);
		}
	});
	keywordSet.add(glyph.code.toLowerCase());
	keywordSet.add(codeUpper);
	keywordSet.add(`0x${glyph.code.toLowerCase()}`);
	keywordSet.add(`0x${codeUpper}`);
	keywordSet.add(`\\u${codeUpper}`);
	keywordSet.add(htmlEntity.toLowerCase());
	keywordSet.add(htmlEntity);
	keywordSet.add(displayName.toLowerCase());

	words.forEach(word => {
		const normalized = word.toLowerCase();
		keywordSet.add(normalized);

		if (normalized.includes('+')) {
			keywordSet.add(normalized.replace('+', 'plus'));
			keywordSet.add('+');
		}
		if (normalized.includes('-')) {
			keywordSet.add(normalized.replace('-', ' '));
		}

		addSynonyms(normalized).forEach(synonym => keywordSet.add(synonym));
	});

	const markdown = [
		`# ${glyph.char} ${displayName}`,
		'',
		`- **Nerd Font name:** \`${nerdFontId}\``,
		`- **Identifier:** \`${id}\``,
		`- **Icon pack:** ${packLabel}`,
		`- **Unicode:** \`0x${codeUpper}\``,
		`- **HTML entity:** \`${htmlEntity}\``,
	].join('\n');

	return {
		id,
		pack,
		packLabel,
		displayName,
		char: glyph.char,
		code: glyph.code,
		hexCode: `0x${codeUpper}`,
		htmlEntity,
		nerdFontId,
		keywords: Array.from(keywordSet),
		markdown,
	};
}

function splitNameIntoWords(value: string): string[] {
	if (!value) {
		return [];
	}

	return value
		.split(/[_-]/g)
		.map(part => part.trim())
		.filter(Boolean);
}

function toTitleCase(word: string): string {
	const lower = word.toLowerCase();

	if (ACRONYMS.has(lower)) {
		return lower.toUpperCase();
	}

	if (/^\d+$/.test(word)) {
		return word;
	}

	if (word.length <= 2) {
		return word.toUpperCase();
	}

	return word.charAt(0).toUpperCase() + word.slice(1);
}

function addSynonyms(token: string): string[] {
	const synonyms = TOKEN_SYNONYMS[token] ?? [];
	const extras: string[] = [];

	if (token === 'plus') {
		extras.push('+', 'add');
	}
	if (token === 'minus') {
		extras.push('-', 'subtract');
	}
	if (token === 'times') {
		extras.push('x');
	}
	if (token === 'close') {
		extras.push('quit');
	}

	return [...synonyms, ...extras].map(entry => entry.toLowerCase());
}
