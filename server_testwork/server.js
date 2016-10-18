var http = require("http"),
	url = require("url"),
	qs = require("querystring"),
	fs = require("fs"),
	cluster = require('cluster');

//----------------------------------------------------------------------

//Данные для подтверждения входа
var personAccess = [ { "name" : "user", "accessLevel" : "user", "password" : "user" }, 
					 { "name" : "admin", "accessLevel" : "admin", "password" : "admin" }];

globalUserInfo = [];

//"Прослушиваем" ответ от "мастера", копируем его список активных пользователей
process.on('message', function(msg) {
	if(msg){
		console.log('Master to worker: ', msg.data);
		globalUserInfo = JSON.parse(msg.data);
	}
});

//Сопоставление пути из адресной строки с функциями
var handle = {};
	handle["/"] = start;
	handle["/start"] = start;
	handle["/sec"] = secAccess;
	handle["/search"] = searchInTable;
	handle["/add"] = addToTable;
	handle["/logout"] = logout;
	handle["/showall"] = showAllTable;
	
//----------------------------------------------------------------------

//Функция создания сервера
function createServerWithDB(sec, handle){
	return http.createServer(function(request,response){
		    var pathname = url.parse(request.url).pathname;
			console.log("Request for " + pathname + " received.");
			route(handle, pathname, sec, response, request);	
	});
};

//----------------------------------------------------------------------

//"Маршрутизация" по функциям
function route(handle, pathname, sec, response, request) {
	console.log("About to route a request for " + pathname);
	if(typeof handle[pathname] === 'function'){
		handle[pathname](response, request, sec);
	}else{
		console.log("No request handler found for " + pathname);
		response.writeHead(404, {"Content-Type": "text/html", "encoding": 'utf8'});
		response.write("404 Not found");
		response.end();
	}
}

//----------------------------------------------------------------------

//Начальная страница авторизация
function start(response, request){
	console.log("Request handler 'start' was called.");
	var count = 0;

	if(globalUserInfo.length === 0){
		fs.readFile('./index.html', function(err, html){
			if(err) throw err;    
			response.writeHeader(200, {"Content-Type": "text/html", "encoding": 'utf8'});  
			response.write(html);  
			response.end();
		});
	}else{
		for(var ix in globalUserInfo){
			if(globalUserInfo[ix].ipAddr != request.connection.remoteAddress){
				continue;
			}else if(globalUserInfo[ix].accessLevel === "user"){
				createDbPage(response, globalUserInfo[ix].name, "");
				count = 1;
				break;
			}else if(globalUserInfo[ix].accessLevel === "admin"){
				createDbPageAdmin(response, globalUserInfo[ix].name, "");
				count = 1;
				break;
			}
		}
		if(count === 0){ 
			fs.readFile('./index.html', function(err, html){
				if(err) throw err;    
				response.writeHeader(200, {"Content-Type": "text/html", "encoding": 'utf8'});  
				response.write(html);  
				response.end();
			});
		}
	}
}

//----------------------------------------------------------------------

//Отправка данных пользователя на сервер для авторизации (не https, если необходимо - сделаю)
function secAccess(response, request, sec){
	var queryData = "";

    if(request.method == 'POST'){ 
        request.on('data', function(data) {
            queryData += data;
            if(queryData.length > 1e6) {
                queryData = "";
                response.writeHead(413, {'Content-Type': 'text/plain', "encoding": 'utf8'}).end();
                request.connection.destroy();
            }
        });

        request.on('end', function() {
            response.post = qs.parse(queryData);
            workWithPost(response, request, sec);
        });

    }else{
        response.writeHead(405, {'Content-Type': 'text/plain', "encoding": 'utf8'});
        response.end();
    }
}

//----------------------------------------------------------------------

//Добавляем пользователя в базу данных активных сеансов
function workWithPost(response, request, sec){
	var count = 0;
	for(var ix in sec){
		if(sec[ix].name == response.post.name && sec[ix].password == response.post.password){
			globalUserInfo[globalUserInfo.length] = {};

			globalUserInfo[globalUserInfo.length-1]["ipAddr"] = request.connection.remoteAddress;
			globalUserInfo[globalUserInfo.length-1]["name"] = sec[ix].name;
			globalUserInfo[globalUserInfo.length-1]["accessLevel"] = sec[ix].accessLevel;
			count = 1;
			
			//Отправляем данные пользователя к "мастеру"
			process.send({ data : JSON.stringify(globalUserInfo[globalUserInfo.length-1]), label : "edit"});
			
			openDb(response, request);
			break; 
		}
	}
	if(count === 0) pageBlock(response, "У вас нет доступа к базе данных.");
}

//----------------------------------------------------------------------

//Создаем страницу доступа к хранилищу
function openDb(response, request){
	var count = 0;
	for(var ix in globalUserInfo){
		if(globalUserInfo[ix].ipAddr != request.connection.remoteAddress){
			continue;
		}else if(globalUserInfo[ix].accessLevel === "user"){
			console.log(globalUserInfo[ix].name);
			createDbPage(response, globalUserInfo[ix].name, "");
			count = 1;
			break;
		}else if(globalUserInfo[ix].accessLevel === "admin"){
			createDbPageAdmin(response, globalUserInfo[ix].name, "");
			count = 1;
			break;
		}
	}
	if(count === 0) pageBlock(response, "У вас нет доступа к базе данных.");
}

//----------------------------------------------------------------------

//Загружаем в оперативную память данные из таблицы
function parsTable(response, callfunc, data1, ipAddr){
	var info = "";
	var table = [];
	fs.readFile('./table.txt', {encoding: 'utf8'}, function(err, data){
		if (err) throw err;
		info = info + data;
		
		info = info.split("\n");
		for(var ix in info){
			var buf = info[ix].split("|");
			if(buf[1] === undefined) continue;
			table[ix] = {};
			table[ix]["key"] = buf[0];
			table[ix]["value"] = buf[1];
		}
		
		//Отправляем их в нужную функцию
		callfunc(response, table, data1, ipAddr);
	});
}

//----------------------------------------------------------------------

//Создаем страницу, оповещающую о невозможности доступа к хранилищу
function pageBlock(response,text){
	console.log("Page blocked");
	response.writeHeader(200, {"Content-Type": "text/html", "encoding": 'utf8'});  
	response.write(text);
	response.end();
}

//----------------------------------------------------------------------

//Создаем "пользовательскую" страницу доступа к хранилищу
function createDbPage(response, userName, text){
	fs.readFile('./db.html', function(err, html){
		if(err) throw err;    
		response.writeHeader(200, {"Content-Type": "text/html", "encoding": 'utf8'});  
		
		html = html + '<div class="userInfo">Вы авторизованы как ' + userName + '</div>' + 
					  text +
					  '</body></html>';
					  
		response.write(html);
		response.end();
	});
}
//----------------------------------------------------------------------

//Создаем страницу доступа к хранилищу для администратора
function createDbPageAdmin(response, userName, text){
	fs.readFile('./db.html', function(err, html){
		if(err) throw err;    
		response.writeHeader(200, {"Content-Type": "text/html", "encoding": 'utf8'});  
		
		html = html + '<div class="userInfo">Вы авторизованы как ' + userName + '</div>' + 
					  '<div class="addField"><form action="./add" method="get">' +
					  '<div class="textField">Ключ: <input type="text" name="key"/></div>' +
					  '<div class="textField">Текст: <input type="text" name="value"/></div>' +
					  '<input type="submit" value="Добавить"/> ' +
					  '</form></div>' +
					  text +
					  '</body></html>';
					  
		response.write(html);
		response.end();
	});
}

//----------------------------------------------------------------------

//Функция для работы с поиском (метод GET)
function searchInTable(response, request){
	if(request.method=='GET') {
        var url_parts = url.parse(request.url,true);
        parsTable(response, searchProcess, url_parts.query, request.connection.remoteAddress);        
    }else{
        response.writeHead(405, {'Content-Type': 'text/plain', "encoding": 'utf8'});
        response.end();
    }               
}

//----------------------------------------------------------------------

//Ищем нужные нам данные по ключу и выводим их
function searchProcess(response, table, data, ipAddr){
	var text1 = '<div class="divTable"><strong>Таблица</strong><div class="div1">', 
		text2 = '</div><div class="div2">';
	var count = 0;
	
	for(var ix in table){
		if(table[ix].key === data.key){
			text1 = text1 + '<div class="cell">' + table[ix].key + '</div>';
			text2 = text2 + '<div class="cell">' + table[ix].value + '</div>';
			++count;
		}
	}
	
	text1 = text1 + text2 + '</div>';
	if(count === 0) text1 = '<div class="divTable"><strong>Таблица</strong><br>Нет совпадений</div>';
	
	//Проверяем авторизован ли пользователь и его ранг доступа, затем создаем страницу
	count = 0;
	for(var ix in globalUserInfo){
		if(globalUserInfo[ix].ipAddr != ipAddr){
			continue;
		}else if(globalUserInfo[ix].accessLevel === "user"){
			createDbPage(response, globalUserInfo[ix].name, text1);
			count = 1;
			break;
		}else if(globalUserInfo[ix].accessLevel === "admin"){
			createDbPageAdmin(response, globalUserInfo[ix].name, text1);
			count = 1;
			break;
		}
	} 
	if(count === 0) pageBlock(response, "У вас нет доступа к базе данных.");
}
//----------------------------------------------------------------------

//Функция записи данных в хранилище (сразу после следует вывод информации клиенту для подтверждения записи)
function addToTable(response,request){
	if(request.method=='GET') {
        var url_parts = url.parse(request.url,true);
        
        fs.appendFile('./table.txt', url_parts.query.key + '|' + url_parts.query.value + '\n', {encoding: 'utf8'}, function(err){
			if(err) throw err;
			console.log('The "data to append" was appended to file!');
			parsTable(response, searchProcess, url_parts.query, request.connection.remoteAddress);
		});        
    }else{
        response.writeHead(405, {'Content-Type': 'text/plain', });
        response.end();
    }
}
//----------------------------------------------------------------------

//Деавторизация
function logout(response,request){
	var count = 0;
	for(var ix in globalUserInfo){
		if(globalUserInfo[ix].ipAddr != request.connection.remoteAddress){
			continue;
		}else{
			process.send({ data : JSON.stringify(globalUserInfo[ix]), label : "delete"}); //Отправляем данные о деавторизации "мастеру"
			globalUserInfo.splice(ix,1); //Удаляем запись из списка "активных" пользователей 
			count = 1;
			start(response,request);
			break;
		}
	}
	if(count === 0) pageBlock(response, "У вас нет доступа к базе данных.");
}
//----------------------------------------------------------------------

//Промежуточная функция для вывода всего содержимого таблицы
function showAllTable(response,request){
	parsTable(response, processShowTable, undefined, request.connection.remoteAddress);
}

//----------------------------------------------------------------------

//Подобно процессу поиска, создаем страницу со всеми данными из хранилища
function processShowTable(response, table, data, ipAddr){
	var text1 = '<div class="divTable"><strong>Таблица</strong><div class="div1">', 
		text2 = '</div><div class="div2">';
	var count = 0;
	
	console.log(table);
	for(var ix in table){
		text1 = text1 + '<div class="cell">' + table[ix].key + '</div>';
		text2 = text2 + '<div class="cell">' + table[ix].value + '</div>';
		++count;
	}
	
	text1 = text1 + text2 + '</div>';
	if(count === 0) text1 = '<div class="divTable"><strong>Таблица</strong><br>Таблица пуста</div>';
	
	//Проверяем авторизован ли пользователь и его ранг доступа, затем создаем страницу
	count = 0;
	for(var ix in globalUserInfo){
		if(globalUserInfo[ix].ipAddr != ipAddr){
			continue;
		}else if(globalUserInfo[ix].accessLevel === "user"){
			createDbPage(response, globalUserInfo[ix].name, text1);
			count = 1;
			break;
		}else if(globalUserInfo[ix].accessLevel === "admin"){
			createDbPageAdmin(response, globalUserInfo[ix].name, text1);
			count = 1;
			break;
		}
	} 
	if(count === 0) pageBlock(response, "У вас нет доступа к базе данных.");
}

//----------------------------------------------------------------------

//Создаем сервер
createServerWithDB(personAccess, handle).listen(8008);
console.log("Server has started.");

//----------------------------------------------------------------------
