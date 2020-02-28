/* eslint-disable complexity */
import HitBox from './hitbox';
import Positioner from './positioners';

function hasAdjustments(paddings) {
	for (var i = 0; i < Object.keys(paddings).length; i++) {
		if (paddings[Object.keys(paddings)[i]] > 0) {
			return true;
		}
	}
	return false;
}

function coordinates(view, model, geometry) {
	var point = model.positioner(view, model);

	var vx = point.vx;
	var vy = point.vy;

	if (!vx && !vy) {
		// if aligned center, we don't want to offset the center point
		return {x: point.x, y: point.y};
	}

	var w = geometry.w;
	var h = geometry.h;

	// take in account the label rotation
	var rotation = model.rotation;
	var dx =
		Math.abs((w / 2) * Math.cos(rotation)) +
		Math.abs((h / 2) * Math.sin(rotation));
	var dy =
		Math.abs((w / 2) * Math.sin(rotation)) +
		Math.abs((h / 2) * Math.cos(rotation));

	// scale the unit vector (vx, vy) to get at least dx or dy equal to
	// w or h respectively (else we would calculate the distance to the
	// ellipse inscribed in the bounding rect)
	var vs = 1 / Math.max(Math.abs(vx), Math.abs(vy));
	dx *= vx * vs;
	dy *= vy * vs;

	// finally, include the explicit offset
	dx += model.offset * vx;
	dy += model.offset * vy;

	return {
		x: point.x + dx,
		y: point.y + dy
	};
}

function collide(labels, collider) {
	var i, j, s0, s1;

	// IMPORTANT Iterate in the reverse order since items at the end of the
	// list have an higher weight/priority and thus should be less impacted
	// by the overlapping strategy.

	for (i = labels.length - 1; i >= 0; --i) {
		s0 = labels[i].$layout;

		for (j = i - 1; j >= 0 && s0._visible; --j) {
			s1 = labels[j].$layout;

			if (s1._visible && s0._box.intersects(s1._box)) {
				collider(s0, s1);
			}
		}
	}

	return labels;
}

function compute(labels) {
	var i, ilen, label, state, geometry, center;

	// Initialize labels for overlap detection
	for (i = 0, ilen = labels.length; i < ilen; ++i) {
		label = labels[i];
		state = label.$layout;

		if (state._visible) {
			geometry = label.geometry();
			center = coordinates(label._el._model, label.model(), geometry);
			state._box.update(center, geometry, label.rotation());
		}
	}

	// Auto hide overlapping labels
	return collide(labels, function(s0, s1) {
		var h0 = s0._hidable;
		var h1 = s1._hidable;

		if ((h0 && h1) || h1) {
			s1._visible = false;
		} else if (h0) {
			s0._visible = false;
		}
	});
}

export default {
	center: {},
	isRendered: false,
	visible: false,
	isAdjusted: false,
	prepare: function(datasets) {
		var labels = [];
		var i, j, ilen, jlen, label;

		for (i = 0, ilen = datasets.length; i < ilen; ++i) {
			for (j = 0, jlen = datasets[i].length; j < jlen; ++j) {
				label = datasets[i][j];
				labels.push(label);
				label.$layout = {
					_box: new HitBox(),
					_hidable: false,
					_visible: true,
					_set: i,
					_idx: j
				};
			}
		}

		// TODO New `z` option: labels with a higher z-index are drawn
		// of top of the ones with a lower index. Lowest z-index labels
		// are also discarded first when hiding overlapping labels.
		labels.sort(function(a, b) {
			var sa = a.$layout;
			var sb = b.$layout;

			return sa._idx === sb._idx ? sb._set - sa._set : sb._idx - sa._idx;
		});

		this.update(labels);

		return labels;
	},

	update: function(labels) {
		var dirty = false;
		var i, ilen, label, model, state;

		for (i = 0, ilen = labels.length; i < ilen; ++i) {
			label = labels[i];
			model = label.model();
			state = label.$layout;
			state._hidable = model && model.display === 'auto';
			state._visible = label.visible();
			dirty |= state._hidable;
		}

		if (dirty) {
			compute(labels);
		}
	},

	lookup: function(labels, point) {
		var i, state;

		// IMPORTANT Iterate in the reverse order since items at the end of
		// the list have an higher z-index, thus should be picked first.

		for (i = labels.length - 1; i >= 0; --i) {
			state = labels[i].$layout;

			if (state && state._visible && state._box.contains(point)) {
				return labels[i];
			}
		}

		return null;
	},

	draw: function(chart, labels) {
		var i, ilen, label, state, geometry;

		for (i = 0, ilen = labels.length; i < ilen; ++i) {
			label = labels[i];
			state = label.$layout;

			if (state._visible) {
				geometry = label.geometry();
				label.center = coordinates(
					label._el._view,
					label.model(),
					geometry
				);
				this.center[i] = label.center;
				state._box.update(label.center, geometry, label.rotation());
				label.draw(chart, label.center);
			}
		}
	},
	adjustLayout: function(chart, labels, _fn, time) {
		if (!chart.$datalabels._adjusted) {
			var paddings = {
				top: 0,
				right: 0,
				bottom: 0,
				left: 0
			};

			var highest = {h: 0, y: 0};
			var rightest = {w: 0, x: 0};
			var lowest = {h: 0, y: 0};
			var leftest = {w: 0, x: 0};

			clearTimeout(chart.$datalabels._adjustTimer);
			// eslint-disable-next-line max-statements
			chart.$datalabels._adjustTimer = setTimeout(function() {
				var paddingDataLabel =
				chart.options &&
				chart.options.plugins &&
				chart.options.plugins.datalabels &&
				chart.options.plugins.datalabels.padding
					? chart.options.plugins.datalabels.padding
					: {};
				for (var i = 0; i < labels.length; i++) {
					var label = labels[i];

					var params = {
						x: label.center ? label.center.x : 0,
						y: label.center ? label.center.y : 0
					};

					if (!highest.y || params.y < highest.y) {
						highest.y = params.y;
						highest.h = label.$layout._box._rect.h;
					}
					if (!rightest.x || params.x > rightest.x) {
						rightest.x = params.x;
						rightest.w = label.$layout._box._rect.w;
					}
					if (!lowest.y || params.y > lowest.y) {
						lowest.y = params.y;
						lowest.h = label.$layout._box._rect.h;
					}
					if (!leftest.x || params.x < leftest.x) {
						leftest.x = params.x;
						leftest.w = label.$layout._box._rect.w;
					}
				}

				var data = {
					highest: highest,
					rightest: rightest,
					lowest: lowest,
					leftest: leftest,
					paddings: chart.options.layout.padding,
					pT: paddingDataLabel.top,
					pB: paddingDataLabel.bottom,
					cW: chart.width,
					cH: chart.height
				};

				if (chart.options.plugins.datalabels.debug) {
					console.debug('data: ', data);
				}

				var top = Positioner.exceededPositions.top(data);
				var right = Positioner.exceededPositions.right(data);
				var bottom = Positioner.exceededPositions.bottom(data);
				var left = Positioner.exceededPositions.left(data);
				paddings.top = top !== 0 ? top : paddings.top;
				paddings.right = right !== 0 ? right : paddings.bottom;
				paddings.bottom = bottom !== 0 ? bottom : paddings.bottom;
				paddings.left = left !== 0 ? left : paddings.left;

				if (chart.options.plugins.datalabels.debug) {
					console.debug('paddings: ', paddings);
				}

				chart.options.layout.padding = paddings;
				chart.update();

				setTimeout(_fn, chart.options.animation.duration / 2);
			}, time);
			chart.$datalabels._adjusted = true;
		}
	}
};
