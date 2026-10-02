export const fixture={
  classification:{subject:'수학',sub_subject:'공통수학2',unit:'좌표와 직선',material_type:'문제·풀이',source_title:'검증용 자료',mode:'문제 풀이/오답',title:'두 점으로 직선의 기울기 이해하기'},
  overview:'검증용 예제입니다. A(0, 1), B(2, 5)를 지나는 직선의 기울기는 2입니다.',
  lesson_sections:[{title:'기울기의 뜻',explanation:'기울기는 x가 증가한 양에 대한 y가 증가한 양의 비율입니다. A에서 B로 갈 때 x는 2, y는 4만큼 증가하므로 기울기는 4 ÷ 2 = 2입니다.',exam_point:'두 점의 x좌표가 같으면 기울기 공식으로 나눌 수 없고 수직선입니다.'},{title:'직선의 식은 왜 y = 2x + 1일까요?',explanation:'직선 위에서는 x가 1 증가할 때 y가 2 증가합니다. A에서 x=0일 때 y=1이므로 출발값은 1입니다. 따라서 y=2x+1이며 B의 x=2를 대입하면 y=5로 원래 조건과 일치합니다.',exam_point:'변화율과 출발값을 구분하세요.'}],
  key_points:['기울기 = y 변화량 / x 변화량','두 점의 좌표를 같은 순서로 빼세요.'],memorize_points:['직선 y = mx + b에서 m은 기울기, b는 y절편입니다.'],
  wrong_note:{status:'wrong',error_type:'계산 실수',where_wrong:'변화량의 비율',why:'검증용 오답 예제: x와 y 변화량을 뒤집었습니다.',fix:'y 변화량을 x 변화량으로 나눕니다.',one_line_rule:'세로 변화량 ÷ 가로 변화량'},
  math_scene:{status:'confirmed',title:'직선 y = 2x + 1',source_basis:'검증용 자료의 A, B 좌표',uncertainty:'',x_min:-2,x_max:4,y_min:-2,y_max:7,points:[{label:'A',x:0,y:1,source_basis:'A(0,1)'},{label:'B',x:2,y:5,source_basis:'B(2,5)'}],lines:[{label:'y = 2x + 1',a:2,b:-1,c:1,source_basis:'두 점으로 계산'}],curves:[],circles:[],polygons:[],segments:[],annotations:[]},
  math_steps:[{problem_id:'p1',title:'가로와 세로 변화량 구하기',explanation:'같은 순서로 B의 좌표에서 A의 좌표를 빼면 가로 2, 세로 4입니다.',formula:'Δx = 2 - 0 = 2, Δy = 5 - 1 = 4',source_basis:'A(0,1), B(2,5)'},{problem_id:'p1',title:'기울기 구하고 검산하기',explanation:'직선의 변화율은 일정합니다. y의 변화량을 x의 변화량으로 나누면 기울기는 2입니다. y=2x+1에 두 점을 대입해 확인합니다.',formula:'m = 4 / 2 = 2',source_basis:'주어진 두 점의 좌표'}],
  problems:[{id:'p1',label:'문제 1',statement:'A(0,1), B(2,5)를 지나는 직선의 기울기를 구하시오.',source_basis:'검증용 문제'}],
  math_similar:[{difficulty:'쉬움',question:'AI 연습문제: (0,0), (1,3)을 지나는 직선의 기울기는?',hint:'가로 변화량은 1입니다.',answer:'3'},{difficulty:'비슷함',question:'AI 연습문제: (1,2), (3,8)을 지나는 직선의 기울기는?',hint:'두 점의 좌표를 같은 순서로 빼세요.',answer:'3'},{difficulty:'어려움',question:'AI 연습문제: 기울기 2인 직선이 (1,3)을 지난다면 y절편은?',hint:'y=2x+b에 점을 대입하세요.',answer:'1'}],
  english:{natural_translation:'',issues:[],vocab:[],grammar:[]},korean:{paragraph_notes:[],hidden_meanings:[],question_review:[]},
  quiz:[{q:'두 점의 x좌표가 같으면 기울기 공식은 어떻게 될까요?',answer:'분모가 0이 되어 기울기를 정의할 수 없습니다.',explanation:'두 점을 잇는 직선은 수직선입니다.'}],
  evidence:[{claim:'직선의 기울기는 2',source_basis:'A(0,1), B(2,5)로 계산: (5-1)/(2-0)=2',confidence:'confirmed'}],unreadable_coordinates:[],limitations:''
};
