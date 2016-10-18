var cluster = require('cluster');

userInfo = [];

cluster.setupMaster({
    exec : './server.js'
});

//Реализация масштабируемости
for(var ix=0; ix < require('os').cpus().length; ++ix){
	worker = cluster.fork(); //Создаем н-ое(в зависимости от процессора) количество копий серверного приложения
	
	worker.on('message', function(msg){ //Получаем сообщение от потомка(воркера)
		if(msg){
			console.log('Worker to master: ', msg.data);
			if(msg.label === "edit"){ 
				//Если в метке указано изменение, то добавляем в конец "мастер-массива"
				//данные от потомка и отправляем потомку текущее состояние "мастер-массива"
				userInfo[userInfo.length] = JSON.parse(msg.data);
				worker.send({ data : JSON.stringify(userInfo)});
			}else if(msg.label === "delete"){
				//Если указано удаление, то находим в "мастер-массиве" данную запись и удаляем ее,
				//затем отправляем текущее состояние "мастер-массива" потомку
				for(var ix in userInfo){
					if(JSON.parse(msg.data).ipAddr === userInfo[ix].ipAddr){
						userInfo.splice(ix,1);
						worker.send({ data : JSON.stringify(userInfo)});
						break;
					}
				}
			}
		}
    });
}
