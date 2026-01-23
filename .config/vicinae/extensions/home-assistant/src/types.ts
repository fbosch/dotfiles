export type LightAttributes = {
	brightness?: number;
	friendly_name?: string;
	color_mode?: string;
	color_temp?: number;
	min_mireds?: number;
	max_mireds?: number;
};

export type LightState = {
	entity_id: string;
	state: string;
	attributes: LightAttributes;
	last_changed: string;
	last_updated: string;
};
