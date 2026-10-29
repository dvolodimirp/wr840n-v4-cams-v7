'use strict';
'require form';
'require fs';
'require ui';
'require uci';

function okCred(section_id, value) {
	if (value === '' || value == null)
		return true;
	return /^[A-Za-z0-9._~-]{1,32}$/.test(value) ||
		'Дозволені літери, цифри та . _ ~ - (до 32 символів)';
}

return L.view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.exec_direct('/usr/sbin/cams-list'), ''),
			uci.load('cams')
		]);
	},

	render: function(data) {
		var listing = data[0];
		var infoOn = uci.get('cams', 'defaults', 'info') === '1';
		var self = this;
		var m, s, o, rows = [];
		var notes = {
			rotfallback: 'поворот 180°: використано mjpg-streamer (ustreamer не вміє розвертати ці камери)',
			rotignored: 'поворот 180° у ustreamer не застосовується'
		};

		String(listing || '').split('\n').forEach(function(line) {
			var f = line.split('|');
			if (f.length < 16)
				return;
			var path = (f[15] == 'ustreamer') ? '/stream' : '/?action=stream';
			var url = location.protocol + '//' + location.hostname + ':' + f[2] + path;
			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, f[13]),
				E('td', { 'class': 'td' }, f[0]),
				E('td', { 'class': 'td' }, f[15] == 'ustreamer' ? 'ustreamer' : 'mjpg-streamer'),
				E('td', { 'class': 'td' }, E('a', { href: url, target: '_blank' }, url)),
				E('td', { 'class': 'td' }, f[3] ? 'так' : 'ні'),
				E('td', { 'class': 'td' }, notes[f[23]] || '')
			]));
		});

		function runInit(action, okText) {
			return fs.exec('/etc/init.d/cams', [ action ]).then(function() {
				ui.addNotification(null, E('p', okText), 'info');
			}).catch(function(e) {
				ui.addNotification(null, E('p', 'Помилка: ' + e.message), 'danger');
			});
		}

		function btn(label, cls, fn) {
			return E('button', {
				'class': 'cbi-button ' + cls,
				'style': 'margin-right:.5em',
				'click': ui.createHandlerFn(self, fn)
			}, label);
		}

		var info = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, 'Активні потоки'),
			rows.length ? E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, 'Камера'),
					E('th', { 'class': 'th' }, 'Пристрій'),
					E('th', { 'class': 'th' }, 'Рушій'),
					E('th', { 'class': 'th' }, 'Адреса потоку'),
					E('th', { 'class': 'th' }, 'Пароль'),
					E('th', { 'class': 'th' }, 'Примітка')
				])
			].concat(rows)) : E('p', {}, E('em', {}, 'Камер не знайдено або всі вимкнені.')),
			E('div', { 'style': 'margin-top:.8em' }, [
				btn('Запустити', 'cbi-button-positive', function() {
					return runInit('start', 'Потоки запущено. Оновіть сторінку через кілька секунд.');
				}),
				btn('Зупинити', 'cbi-button-negative', function() {
					return runInit('stop', 'Потоки зупинено.');
				}),
				btn('Перезапустити', 'cbi-button-action', function() {
					return runInit('restart', 'Потоки перезапущено. Оновіть сторінку через кілька секунд.');
				}),
				btn('Застосувати яскравість тощо', 'cbi-button', function() {
					return fs.exec('/usr/sbin/cams-apply', []).then(function() {
						ui.addNotification(null, E('p', 'Параметри зображення застосовано.'), 'info');
					});
				}),
				infoOn ? E('a', {
					'class': 'cbi-button cbi-button-link',
					'href': L.url('admin', 'services', 'cams-info')
				}, 'Відкрити трафік потоків →') : ''
			])
		]);

		m = new form.Map('cams', 'Вебкамери',
			'Налаштування USB-камер. Нові камери з\'являються тут автоматично після підключення. ' +
			'Зміна роздільності, частоти, порту, рушія чи пароля перезапускає потоки (кілька секунд без картинки); ' +
			'зміна яскравості, контрасту тощо застосовується на ходу.');

		/* ---------- general ---------- */
		s = m.section(form.NamedSection, 'defaults', 'defaults', 'Загальне');
		s.addremove = false;

		o = s.option(form.ListValue, 'engine', 'Рушій потоку за замовчуванням');
		o.value('ustreamer', 'ustreamer');
		o.value('mjpg', 'mjpg-streamer');
		o.default = 'ustreamer';
		o.description = 'Для кожної камери можна вибрати свій рушій на вкладці «Рушій». ' +
			'Камера з поворотом 180° і рушієм «за замовчуванням» автоматично працює через mjpg-streamer.';

		o = s.option(form.Flag, 'info', 'Меню «Вебкамери: трафік»');
		o.default = '0';
		o.rmempty = false;
		o.description = 'Додає пункт меню з живою статистикою потоків (кадри на кожному кроці, трафік, глядачі) ' +
			'і вмикає лічильники байтів. Після збереження оновіть сторінку.';

		/* ---------- cameras ---------- */
		s = m.section(form.TypedSection, 'camera', 'Камери');
		s.anonymous = true;
		s.addremove = false;
		s.tab('stream', 'Потік');
		s.tab('image', 'Зображення');
		s.tab('engine', 'Рушій');

		/* --- tab: stream --- */
		o = s.taboption('stream', form.DummyValue, 'name', 'Камера');

		o = s.taboption('stream', form.Flag, 'enabled', 'Увімкнено');
		o.default = '1';
		o.rmempty = false;

		o = s.taboption('stream', form.ListValue, 'res', 'Роздільність');
		[ '160x120', '176x144', '320x240', '352x288', '640x480' ].forEach(function(v) { o.value(v); });
		o.default = '352x288';
		o.description = 'Камери без MJPEG стискаються процесором роутера: 640x480 доступно лише з дуже низькою частотою.';

		o = s.taboption('stream', form.ListValue, 'fps', 'Частота кадрів');
		[ '5', '10', '15', '20', '25', '30' ].forEach(function(v) { o.value(v); });
		o.default = '5';
		o.description = 'Береться з частот, які підтримує камера (зазвичай 5, 10, 15, 20...). Вище 5 к/с для двох камер на 352x288 зависатиме процесор.';

		o = s.taboption('stream', form.ListValue, 'rotate', 'Поворот зображення');
		o.value('0', 'без повороту');
		o.value('180', '180°');
		o.default = '0';
		o.description = 'Працює лише в mjpg-streamer. Камера з поворотом 180° і рушієм «за замовчуванням» автоматично переходить на mjpg-streamer. Застосовується з перезапуском потоку.';

		o = s.taboption('stream', form.Value, 'port', 'Порт');
		o.datatype = 'port';
		o.placeholder = 'авто (8080, 8081, ...)';
		o.optional = true;

		o = s.taboption('stream', form.Value, 'user', 'Логін потоку');
		o.optional = true;
		o.validate = okCred;
		o.description = 'Порожньо = без пароля. Пароль передається без шифрування (HTTP Basic), зберігається у відкритому вигляді в /etc/config/cams.';

		o = s.taboption('stream', form.Value, 'pass', 'Пароль потоку');
		o.optional = true;
		o.password = true;
		o.validate = okCred;

		/* --- tab: image --- */
		o = s.taboption('image', form.Value, 'brightness', 'Яскравість');
		o.datatype = 'integer';
		o.optional = true;
		o.placeholder = 'без змін';
		o.description = 'Діапазон залежить від камери (HP Webcam: -64...127).';

		o = s.taboption('image', form.Value, 'contrast', 'Контрастність');
		o.datatype = 'integer';
		o.optional = true;
		o.placeholder = 'без змін';

		o = s.taboption('image', form.Value, 'saturation', 'Насиченість');
		o.datatype = 'integer';
		o.optional = true;
		o.placeholder = 'без змін';

		o = s.taboption('image', form.Value, 'gamma', 'Гамма');
		o.datatype = 'integer';
		o.optional = true;
		o.placeholder = 'без змін';

		o = s.taboption('image', form.Value, 'sharpness', 'Різкість');
		o.datatype = 'integer';
		o.optional = true;
		o.placeholder = 'без змін';

		o = s.taboption('image', form.ListValue, 'powerline', 'Частота мережі (проти мерехтіння)');
		o.value('', 'без змін');
		o.value('0', 'вимкнено');
		o.value('1', '50 Гц');
		o.value('2', '60 Гц');
		o.optional = true;

		/* --- tab: engine --- */
		o = s.taboption('engine', form.ListValue, 'engine', 'Рушій цієї камери');
		o.value('auto', 'за замовчуванням');
		o.value('ustreamer', 'ustreamer');
		o.value('mjpg', 'mjpg-streamer');
		o.default = 'auto';

		o = s.taboption('engine', form.Value, 'quality', 'Якість JPEG (ustreamer)');
		o.datatype = 'range(1,100)';
		o.optional = true;
		o.placeholder = '80';
		o.description = 'Нижча якість = менший трафік і менше навантаження на процесор.';

		o = s.taboption('engine', form.Flag, 'nodelay', 'TCP_NODELAY (ustreamer)');
		o.default = '1';
		o.rmempty = false;
		o.description = 'Надсилати кадри без затримки накопичення пакетів.';

		o = s.taboption('engine', form.Flag, 'slowdown', 'Економити процесор без глядачів (ustreamer)');
		o.default = '0';
		o.rmempty = false;
		o.description = 'Без підключених глядачів знімати не частіше 1 к/с.';

		o = s.taboption('engine', form.Flag, 'exit_on_error', 'Завершувати процес при збої камери (ustreamer)');
		o.default = '0';
		o.rmempty = false;
		o.description = 'Вимкнено: ustreamer сам перевідкриває камеру. Увімкнено: процес завершується, і procd запускає його заново через 5 с.';

		o = s.taboption('engine', form.Value, 'drop_same', 'Не слати однакові кадри, не більше N підряд (ustreamer)');
		o.datatype = 'uinteger';
		o.optional = true;
		o.placeholder = 'вимкнено';
		o.description = 'Зменшує трафік при нерухомій картинці, але збільшує навантаження процесора.';

		o = s.taboption('engine', form.Value, 'buffers', 'Буферів захоплення (ustreamer)');
		o.datatype = 'range(1,8)';
		o.optional = true;
		o.placeholder = 'за замовчуванням';

		o = s.taboption('engine', form.Value, 'workers', 'Потоків кодування (ustreamer)');
		o.datatype = 'range(1,4)';
		o.optional = true;
		o.placeholder = 'за замовчуванням';
		o.description = 'Роутер має одне ядро: більше потоків зазвичай не прискорює.';

		return m.render().then(function(node) {
			return E([ info, node ]);
		});
	}
});
